import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ERROR_MESSAGES, nicknameSchema, parseInviteLink, PROTOCOL_VERSION,
} from "@deskbrawl/protocol";
import type {
  Joined, PlayerProfile, Session, Snapshot,
} from "@deskbrawl/protocol";
import { readCharacterSkin, saveCharacterSkin } from "../../game/characterPreference";
import { CHARACTERS } from "../../game/characters";
import {
  getRoom,
  registerDevice,
  RoomError,
  roomErrorMessage,
  restoreDevice,
  revokeInvite,
  rotateInvite,
  SERVER_ORIGIN,
} from "../../api/rooms";
import {
  hostBounds,
  publishNetwork,
  readCredential,
  storeCredential,
  watchInvites,
} from "../../native/network";
import type { LocalCommand } from "../../native/localGame";
import { watchCharacterPlacement } from "../../native/drag";
import { createVisitClient } from "../../realtime/visitClient";
import type { VisitClient } from "../../realtime/visitClient";
import { openChat, watchChat, watchChatRequest } from "../../native/chat";
import {
  publishInviteLink, readFocus, setNativeFocus, watchFocus,
} from "../../native/focus";

interface MultiplayerView {
  phase: "local" | "connecting" | "reconnecting" | "host" | "guest" | "error";
  error?: string;
  notice?: string;
  members: Snapshot["members"];
}

const SESSION_REUSE_MARGIN_MS = 60_000;
const roomKey = (deviceId: string) => ["room", "mine", SERVER_ORIGIN, deviceId] as const;

export function useMultiplayer() {
  const [view, setView] = useState<MultiplayerView>({ phase: "local", members: [] });
  const client = useRef<VisitClient | undefined>(undefined);
  const current = useRef<Snapshot | undefined>(undefined);
  const listeners = useRef(new Set<(snapshot: Snapshot) => void>());
  const live = useRef(false);
  const session = useRef<Session | undefined>(undefined);
  const operation = useRef<Promise<void> | undefined>(undefined);
  const disconnectTask = useRef<Promise<void> | undefined>(undefined);
  const pendingInvite = useRef<string | undefined>(undefined);
  const [focused, setFocused] = useState(false);
  const [focusLoaded, setFocusLoaded] = useState(false);
  const focusValue = useRef(false);
  const focusQueue = useRef<Promise<void>>(Promise.resolve());
  const mode = useRef<"host" | "guest">("host");
  const guestToken = useRef<string | undefined>(undefined);
  const focusReturnToken = useRef<string | undefined>(undefined);
  const [skin, setSkin] = useState(readCharacterSkin);
  const skinValue = useRef(skin);
  const nicknameValue = useRef<string>(undefined);
  const [savedNickname, setSavedNickname] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>();
  const room = useQuery({
    queryKey: roomKey(deviceId ?? "pending"),
    enabled: deviceId !== undefined,
    queryFn: ({ signal }) => {
      if (session.current === undefined) {
        throw new RoomError(ERROR_MESSAGES.UNAUTHORIZED);
      }
      return getRoom(session.current, signal);
    },
    retry: false,
    staleTime: Infinity,
  });

  async function resetConnection(next: MultiplayerView): Promise<void> {
    current.current = undefined;
    setView(next);
    await Promise.all([publishInviteLink(null), publishNetwork({ mode: "local", snapshot: null })]);
  }
  function report(error: unknown): void {
    finishConnection(error);
  }
  function finishConnection(error: unknown, notice?: string): void {
    if (!live.current || disconnectTask.current || abort.current?.signal.aborted) {
      return;
    }
    client.current?.dispose();
    client.current = undefined;
    if (notice === undefined && !(error instanceof RoomError)) {
      console.error("공간 연결 처리 실패", error);
    }
    const next: MultiplayerView = notice === undefined
      ? { phase: "error", error: roomErrorMessage(error), members: [] }
      : { phase: "local", notice, members: [] };
    void resetConnection(next).catch((failure: unknown) => console.error("연결 상태 정리 실패", failure));
  }
  function defaultNickname(): string {
    return nicknameValue.current ?? CHARACTERS[skinValue.current].name;
  }
  function receive(snapshot: Snapshot): void {
    if (!live.current || disconnectTask.current || abort.current?.signal.aborted) {
      return;
    }
    const self = snapshot.members.find((member) => member.playerId === session.current?.deviceId);
    if (self !== undefined && self.nickname !== nicknameValue.current) {
      nicknameValue.current = self.nickname;
      setSavedNickname(self.nickname);
    }
    current.current = snapshot;
    for (const listener of listeners.current) {
      listener(snapshot);
    }
    setView((previous) => JSON.stringify(previous.members) === JSON.stringify(snapshot.members) ? previous : { ...previous, members: snapshot.members });
    const playerId = client.current?.canPlace() ? client.current.playerId() : undefined;
    void publishNetwork({ mode: mode.current, snapshot, ...(playerId === undefined ? {} : { playerId }) }).catch((error: unknown) => report(error));
  }
  async function authenticate(nickname: string, signal: AbortSignal): Promise<Session> {
    if (session.current !== undefined && session.current.expiresAt - Date.now() > SESSION_REUSE_MARGIN_MS) {
      return session.current;
    }
    const credential = await readCredential(SERVER_ORIGIN);
    signal.throwIfAborted();
    let result: Session;
    if (credential !== undefined) {
      result = await restoreDevice(credential, signal);
    } else {
      const registered = await registerDevice(nickname, signal);
      // Persist before hosting. A storage failure must not silently leave an unrecoverable identity.
      await storeCredential(SERVER_ORIGIN, { deviceId: registered.deviceId, secret: registered.secret });
      result = { deviceId: registered.deviceId, accessToken: registered.accessToken, expiresAt: registered.expiresAt };
    }
    signal.throwIfAborted();
    session.current = result;
    setDeviceId(result.deviceId);
    return result;
  }
  async function enter(token: string | undefined, nickname = defaultNickname(), saveNickname = false): Promise<void> {
    if (disconnectTask.current !== undefined) {
      await disconnectTask.current.catch(() => { /* Local state is reset even when leave fails. */ });
      if (!live.current) {
        return;
      }
    }
    if (token !== undefined && focusValue.current) {
      throw new RoomError(ERROR_MESSAGES.ROOM_UNAVAILABLE);
    }
    if (operation.current !== undefined) {
      pendingInvite.current = token ?? pendingInvite.current;
      return operation.current;
    }
    const controller = new AbortController();
    abort.current = controller;
    const { signal } = controller;
    const task = (async () => {
      try {
        setView({ phase: "connecting", members: [] });
        let previous = client.current;
        try {
          await previous?.leave();
        } catch (error) {
          previous?.dispose();
          throw error;
        }
        signal.throwIfAborted();
        await publishInviteLink(null);
        const previousSession = session.current;
        const auth = await authenticate(nickname, signal);
        signal.throwIfAborted();
        if (auth !== previousSession) {
          previous?.dispose();
          previous = undefined;
        }
        if (!live.current) {
          return;
        }
        mode.current = token === undefined ? "host" : "guest";
        // Room switches reuse the authenticated socket instead of spending another handshake.
        const connection = previous ?? createVisitClient(auth, receive, (message, closure) => {
          if (closure === undefined) {
            report(new RoomError(message));
          } else {
            finishConnection(new RoomError(message), closure === "HOST_OFFLINE" ? "친구가 공간을 닫았어요." : message);
          }
        }, (state) => {
          if (!live.current || disconnectTask.current || abort.current?.signal.aborted) {
            return;
          }
          setView((previous) => ({ ...previous, phase: state === "reconnecting" ? "reconnecting" : mode.current }));
          if (state === "reconnecting") {
            const frozen = current.current === undefined ? null : { ...current.current, chats: [] };
            if (frozen !== null) {
              current.current = frozen;
              for (const listener of listeners.current) {
                listener(frozen);
              }
            }
            void publishNetwork({ mode: "recovering", snapshot: frozen, playerId: auth.deviceId }).catch(report);
          }
        }, {
          async issue(signal) {
            const credential = await readCredential(SERVER_ORIGIN);
            signal.throwIfAborted();
            if (credential?.deviceId !== auth.deviceId) {
              throw new RoomError(ERROR_MESSAGES.UNAUTHORIZED, "UNAUTHORIZED");
            }
            return restoreDevice(credential, signal);
          },
          onRenewed(next) {
            if (session.current?.deviceId === next.deviceId && session.current.expiresAt < next.expiresAt) {
              session.current = next;
            }
          },
        });
        client.current = connection;
        if (previous === undefined) {
          await connection.connect();
        }
        signal.throwIfAborted();
        const bounds = token === undefined ? await hostBounds() : undefined;
        signal.throwIfAborted();
        const joined: Joined = token === undefined
          ? await connection.enter("room:host", { version: PROTOCOL_VERSION, bounds, focused: focusValue.current })
          : await connection.enter("visit:join", { version: PROTOCOL_VERSION, token });
        signal.throwIfAborted();
        guestToken.current = token;
        await connection.setProfile({ skin: skinValue.current, ...(saveNickname ? { nickname } : {}) });
        signal.throwIfAborted();
        if (live.current) {
          setView((previous) => ({ ...previous, phase: joined.role }));
          if (joined.role === "host" && invite.data !== undefined && invite.data.expiresAt > Date.now()) {
            await publishInviteLink(invite.data.link);
          }
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        report(error);
        throw error;
      }
    })();
    operation.current = task;
    try {
      await task;
    } finally {
      operation.current = undefined;
      if (abort.current === controller && !signal.aborted) {
        abort.current = undefined;
      }
      const pending = pendingInvite.current;
      pendingInvite.current = undefined;
      if (live.current && !signal.aborted && pending !== undefined && pending !== token) {
        void enter(pending).catch(() => {
          // enter가 report를 통해 연결 오류와 정리를 처리한다.
        });
      }
    }
  }
  const connect = useMutation({
    mutationFn: ({ nickname, edited }: { nickname: string; edited: boolean }) => enter(undefined, nickname, edited),
    onSuccess: () => {
      const needsLink = invite.data === undefined || invite.data.expiresAt <= Date.now();
      if (!disconnectTask.current && !abort.current?.signal.aborted && mode.current === "host" && client.current && needsLink) {
        invite.mutate();
      }
    },
    retry: false,
  });
  const join = useMutation({
    mutationFn: ({ link, nickname, edited }: { link: string; nickname: string; edited: boolean }) => {
      let token: string;
      try {
        token = parseInviteLink(link, SERVER_ORIGIN);
      } catch {
        throw new RoomError(ERROR_MESSAGES.INVALID_INVITE);
      }
      return enter(token, nickname, edited);
    },
    retry: false,
  });
  const returning = useMutation({
    mutationFn: async () => {
      try {
        focusReturnToken.current = undefined;
        await enter(undefined);
      } catch (error) {
        report(error);
        throw error;
      }
    },
    retry: false,
  });
  const profile = useMutation({
    mutationFn: async (next: PlayerProfile) => {
      const nickname = next.nickname === undefined ? undefined : nicknameSchema.safeParse(next.nickname);
      if (nickname !== undefined && !nickname.success) {
        throw new RoomError("닉네임을 1~24자로 입력해 주세요.");
      }
      if (client.current !== undefined) {
        await client.current.setProfile({ ...next, ...(nickname?.success ? { nickname: nickname.data } : {}) });
      }
      if (next.skin !== undefined) {
        saveCharacterSkin(next.skin);
        skinValue.current = next.skin;
        setSkin(next.skin);
      }
    },
    retry: false,
  });
  const invite = useMutation({
    mutationFn: async () => {
      if (session.current === undefined) {
        throw new RoomError("먼저 내 공간을 연결해 주세요.");
      }
      return rotateInvite(session.current);
    },
    onSuccess: async (data) => {
      if (live.current && !disconnectTask.current && mode.current === "host" && client.current !== undefined) {
        await publishInviteLink(data.link);
      }
    },
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: async () => {
      if (session.current === undefined) {
        throw new RoomError(ERROR_MESSAGES.UNAUTHORIZED);
      }
      return revokeInvite(session.current);
    },
    onSuccess: async () => {
      invite.reset();
      await publishInviteLink(null);
    },
    retry: false,
  });

  async function synchronizeFocus(next: boolean): Promise<void> {
    if (focusValue.current === next) {
      return focusQueue.current;
    }
    focusValue.current = next;
    setFocused(next);
    if (next) {
      client.current?.pauseInput();
    }
    const task = focusQueue.current.catch(() => {
      // 이전 전환의 오류는 mutation이 표시하고, 다음 전환은 계속 처리한다.
    }).then(async () => {
      await operation.current?.catch(() => {
        // enter가 연결 오류를 표시하고 자원을 정리한다.
      });
      if (!live.current || focusValue.current !== next || client.current === undefined) {
        return;
      }
      if (mode.current === "guest" && next) {
        focusReturnToken.current = guestToken.current;
        await enter(undefined);
      } else if (mode.current === "guest") {
        client.current.resumeInput();
      } else if (mode.current === "host") {
        await client.current.setFocused(next);
        const token = focusReturnToken.current;
        if (!next && token !== undefined) {
          focusReturnToken.current = undefined;
          try {
            await enter(token);
          } catch (error) {
            if (live.current) {
              await enter(undefined);
              setView((previous) => ({ ...previous, error: `이전 공간으로 돌아가지 못했어요. ${roomErrorMessage(error)}` }));
            }
          }
        }
      }
    });
    focusQueue.current = task;
    return task;
  }
  const focus = useMutation({
    mutationFn: async (next: boolean) => {
      await setNativeFocus(next);
      await synchronizeFocus(next);
    },
    onError: report,
    retry: false,
  });
  const kick = useMutation({
    mutationFn: async (targetPlayerId: string) => {
      if (client.current === undefined) {
        throw new RoomError(ERROR_MESSAGES.CONNECTION_LOST);
      }
      await client.current.kick(targetPlayerId);
    },
    retry: false,
  });
  const clearVisitors = useMutation({
    mutationFn: async () => {
      if (client.current === undefined) {
        throw new RoomError(ERROR_MESSAGES.CONNECTION_LOST);
      }
      await client.current.clearVisitors();
    },
    retry: false,
  });

  const acceptInvite = useEffectEvent((link: string) => {
    try {
      const token = parseInviteLink(link, SERVER_ORIGIN);
      void enter(token).catch((error: unknown) => {
        if (focusValue.current) {
          setView((previous) => ({ ...previous, error: roomErrorMessage(error) }));
        }
      });
    } catch {
      setView((previous) => ({ ...previous, error: ERROR_MESSAGES.INVALID_INVITE }));
    }
  });
  const watchFailed = useEffectEvent((error: unknown) => report(error));
  const focusChanged = useEffectEvent((value: boolean) => focus.mutate(value));
  const chatRequested = useEffectEvent(() => {
    const snapshot = current.current;
    const id = client.current?.playerId();
    const player = snapshot?.world.players.find((candidate) => candidate.id === id);
    if (snapshot === undefined || player === undefined) {
      return;
    }
    void openChat(player.position, snapshot.world.bounds).catch(() => {
      setView((previous) => ({ ...previous, error: "채팅 입력창을 열지 못했어요. 플레이 모드에서 / 키를 다시 눌러 주세요." }));
    });
  });
  const chatChanged = useEffectEvent((current: string, previous: string) => client.current?.chat(current, previous));
  const subscribe = useCallback((listener: (snapshot: Snapshot) => void): (() => void) => {
    listeners.current.add(listener);
    if (current.current !== undefined) {
      listener(current.current);
    }
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  useEffect(() => {
    live.current = true;
    let active = true;
    const subscribers = listeners.current;
    let stop: (() => void) | undefined;
    let stopFocus: (() => void) | undefined;
    const chatStops: (() => void)[] = [];
    void (async () => {
      for (const watch of [watchChatRequest(chatRequested), watchChat(chatChanged), watchCharacterPlacement((position) => client.current?.place(position))]) {
        const unwatch = await watch;
        if (active) {
          chatStops.push(unwatch);
        } else {
          unwatch();
        }
      }
      let focusEvent = false;
      const unwatchFocus = await watchFocus((value) => {
        if (active) {
          focusEvent = true;
          focusChanged(value);
        }
      });
      if (!active) {
        unwatchFocus();
        return;
      }
      stopFocus = unwatchFocus;
      const initial = await readFocus();
      if (!active) {
        return;
      }
      if (!focusEvent) {
        focusValue.current = initial;
        setFocused(initial);
      }
      setFocusLoaded(true);
      const unlisten = await watchInvites((link) => {
        if (active) {
          acceptInvite(link);
        }
      });
      if (active) {
        stop = unlisten;
      } else {
        unlisten();
      }
    })().catch((error: unknown) => {
      if (active) {
        watchFailed(error);
      }
    });
    return () => {
      active = false;
      live.current = false;
      abort.current?.abort();
      stop?.();
      stopFocus?.();
      chatStops.forEach((stopChat) => stopChat());
      client.current?.dispose();
      client.current = undefined;
      session.current = undefined;
      current.current = undefined;
      subscribers.clear();
      queryClient.removeQueries({ queryKey: ["room"] });
    };
  }, [queryClient]);
  function disconnect(): Promise<void> {
    if (disconnectTask.current !== undefined) {
      return disconnectTask.current;
    }
    const controller = abort.current;
    controller?.abort();
    pendingInvite.current = undefined;
    focusReturnToken.current = undefined;
    guestToken.current = undefined;
    const task = (async () => {
      // A pending join can already have reached the server. Wait for its ack so
      // leave can close that membership before the socket is disposed.
      await operation.current?.catch(() => { /* Connection errors are reported by enter. */ });
      const connection = client.current;
      client.current = undefined;
      try {
        await connection?.leave();
      } catch (error) {
        console.error("공간 연결 해제 확인 실패", error);
      } finally {
        connection?.dispose();
        if (abort.current === controller) {
          abort.current = undefined;
        }
        await resetConnection({ phase: "local", members: [] });
      }
    })().finally(() => {
      disconnectTask.current = undefined;
    });
    disconnectTask.current = task;
    return task;
  }
  const disconnecting = useMutation({
    mutationFn: disconnect,
    retry: false,
  });
  return {
    view,
    room,
    connect,
    join,
    returning,
    invite,
    revoke,
    focused,
    focus,
    kick,
    clearVisitors,
    profile,
    skin,
    nickname: savedNickname ?? CHARACTERS[skin].name,
    savedNickname,
    self: view.members.find((member) => member.playerId === deviceId),
    connectionBusy: !focusLoaded || view.phase === "connecting" || view.phase === "reconnecting"
      || connect.isPending || join.isPending || returning.isPending || disconnecting.isPending,
    disconnect,
    disconnecting,
    input: (command: LocalCommand): void => {
      if (!disconnectTask.current) {
        client.current?.input(command);
      }
    },
    subscribe,
  };
}
