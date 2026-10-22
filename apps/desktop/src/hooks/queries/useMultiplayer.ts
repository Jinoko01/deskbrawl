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
import {
  getRoom,
  registerDevice,
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
import { createVisitClient } from "../../realtime/visitClient";
import type { VisitClient } from "../../realtime/visitClient";
import { openChat, watchChat, watchChatRequest } from "../../native/chat";
import {
  publishInviteLink, readFocus, setNativeFocus, watchFocus,
} from "../../native/focus";

interface MultiplayerView {
  phase: "local" | "connecting" | "reconnecting" | "host" | "guest" | "error";
  error?: string;
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
  const abort = useRef<AbortController | undefined>(undefined);
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>();
  const room = useQuery({
    queryKey: roomKey(deviceId ?? "pending"),
    enabled: deviceId !== undefined,
    queryFn: ({ signal }) => {
      if (session.current === undefined) {
        throw new Error("UNAUTHORIZED");
      }
      return getRoom(session.current, signal);
    },
    retry: false,
    staleTime: Infinity,
  });

  function report(error: unknown): void {
    if (!live.current) {
      return;
    }
    client.current?.dispose();
    client.current = undefined;
    current.current = undefined;
    void publishInviteLink(null).catch((failure: unknown) => console.error("트레이 링크 정리 실패", failure));
    setView({ phase: "error", error: error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST, members: [] });
    void publishNetwork({ mode: "local", snapshot: null }).catch((failure: unknown) => {
      console.error("네트워크 종료 상태 전달 실패", failure);
    });
  }
  function receive(snapshot: Snapshot): void {
    if (!live.current) {
      return;
    }
    current.current = snapshot;
    for (const listener of listeners.current) {
      listener(snapshot);
    }
    setView((previous) => JSON.stringify(previous.members) === JSON.stringify(snapshot.members) ? previous : { ...previous, members: snapshot.members });
    void publishNetwork({ mode: mode.current, snapshot }).catch((error: unknown) => report(error));
  }
  async function authenticate(nickname: string): Promise<Session> {
    if (session.current !== undefined && session.current.expiresAt - Date.now() > SESSION_REUSE_MARGIN_MS) {
      return session.current;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const credential = await readCredential(SERVER_ORIGIN);
    let result: Session;
    if (credential !== undefined) {
      result = await restoreDevice(credential, controller.signal);
    } else {
      const registered = await registerDevice(nickname, controller.signal);
      // Persist before hosting. A storage failure must not silently leave an unrecoverable identity.
      await storeCredential(SERVER_ORIGIN, { deviceId: registered.deviceId, secret: registered.secret });
      result = { deviceId: registered.deviceId, accessToken: registered.accessToken, expiresAt: registered.expiresAt };
    }
    if (!live.current) {
      throw new Error("Connection cancelled");
    }
    session.current = result;
    setDeviceId(result.deviceId);
    return result;
  }
  async function enter(token: string | undefined, nickname: string): Promise<void> {
    if (token !== undefined && focusValue.current) {
      throw new Error(ERROR_MESSAGES.ROOM_UNAVAILABLE);
    }
    if (operation.current !== undefined) {
      pendingInvite.current = token ?? pendingInvite.current;
      return operation.current;
    }
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
        await publishInviteLink(null);
        const previousSession = session.current;
        const auth = await authenticate(nickname);
        if (auth !== previousSession) {
          previous?.dispose();
          previous = undefined;
        }
        if (!live.current) {
          return;
        }
        mode.current = token === undefined ? "host" : "guest";
        // Room switches reuse the authenticated socket instead of spending another handshake.
        const connection = previous ?? createVisitClient(auth, receive, (message) => report(new Error(message)), (state) => {
          if (!live.current) {
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
            void publishNetwork({ mode: "recovering", snapshot: frozen }).catch(report);
          }
        });
        client.current = connection;
        if (previous === undefined) {
          await connection.connect();
        }
        if (!live.current) {
          connection.dispose();
          return;
        }
        const joined: Joined = token === undefined
          ? await connection.enter("room:host", { version: PROTOCOL_VERSION, bounds: await hostBounds(), focused: focusValue.current })
          : await connection.enter("visit:join", { version: PROTOCOL_VERSION, token });
        guestToken.current = token;
        await connection.setProfile({ skin: skinValue.current });
        if (live.current) {
          setView((previous) => ({ ...previous, phase: joined.role }));
          if (joined.role === "host" && invite.data !== undefined) {
            await publishInviteLink(invite.data.link);
          }
        }
      } catch (error) {
        report(error);
        throw error;
      }
    })();
    operation.current = task;
    try {
      await task;
    } finally {
      operation.current = undefined;
      const pending = pendingInvite.current;
      pendingInvite.current = undefined;
      if (live.current && pending !== undefined && pending !== token) {
        void enter(pending, nickname).catch(() => {
          // enter가 report를 통해 연결 오류와 정리를 처리한다.
        });
      }
    }
  }
  const connect = useMutation({ mutationFn: (nickname: string) => enter(undefined, nickname), retry: false });
  const join = useMutation({
    mutationFn: ({ link, nickname }: { link: string; nickname: string }) => {
      let token: string;
      try {
        token = parseInviteLink(link, SERVER_ORIGIN);
      } catch {
        throw new Error(ERROR_MESSAGES.INVALID_INVITE);
      }
      return enter(token, nickname);
    },
    retry: false,
  });
  const returning = useMutation({
    mutationFn: async () => {
      try {
        focusReturnToken.current = undefined;
        await enter(undefined, "친구");
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
        throw new Error("닉네임을 1~24자로 입력해 주세요.");
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
        throw new Error("먼저 내 공간을 연결해 주세요.");
      }
      return rotateInvite(session.current);
    },
    onSuccess: async (data) => {
      if (live.current && mode.current === "host" && client.current !== undefined) {
        await publishInviteLink(data.link);
      }
    },
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: async () => {
      if (session.current === undefined) {
        throw new Error("UNAUTHORIZED");
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
        await enter(undefined, "친구");
      } else if (mode.current === "guest") {
        client.current.resumeInput();
      } else if (mode.current === "host") {
        await client.current.setFocused(next);
        const token = focusReturnToken.current;
        if (!next && token !== undefined) {
          focusReturnToken.current = undefined;
          try {
            await enter(token, "친구");
          } catch (error) {
            if (live.current) {
              await enter(undefined, "친구");
              setView((previous) => ({ ...previous, error: `이전 방으로 돌아가지 못했어요. ${error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST}` }));
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
        throw new Error(ERROR_MESSAGES.CONNECTION_LOST);
      }
      await client.current.kick(targetPlayerId);
    },
    onError: report,
    retry: false,
  });
  const clearVisitors = useMutation({
    mutationFn: async () => {
      if (client.current === undefined) {
        throw new Error(ERROR_MESSAGES.CONNECTION_LOST);
      }
      await client.current.clearVisitors();
    },
    onError: report,
    retry: false,
  });

  const acceptInvite = useEffectEvent((link: string) => {
    try {
      const token = parseInviteLink(link, SERVER_ORIGIN);
      void enter(token, "친구").catch(() => {
        // enter가 report를 통해 연결 오류와 정리를 처리한다.
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
      setView((previous) => ({ ...previous, error: "채팅 입력창을 열지 못했어요. PLAY에서 / 키로 다시 시도해 주세요." }));
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
      for (const watch of [watchChatRequest(chatRequested), watchChat(chatChanged)]) {
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
  return {
    view,
    room,
    connect,
    join,
    returning,
    invite,
    revoke,
    focused,
    focusLoaded,
    focus,
    kick,
    clearVisitors,
    profile,
    skin,
    self: view.members.find((member) => member.playerId === deviceId),
    disconnect: async (): Promise<void> => {
      try {
        await client.current?.leave();
      } finally {
        client.current?.dispose();
      }
    },
    input: (command: LocalCommand): void => {
      client.current?.input(command);
    },
    subscribe,
  };
}
