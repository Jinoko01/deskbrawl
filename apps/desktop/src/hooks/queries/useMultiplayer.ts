import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ERROR_MESSAGES, parseInviteLink } from "@deskbrawl/protocol";
import type { Joined, Session, Snapshot } from "@deskbrawl/protocol";
import { getRoom, registerDevice, restoreDevice, revokeInvite, rotateInvite, SERVER_ORIGIN } from "../../api/rooms";
import { hostBounds, publishNetwork, readCredential, storeCredential, watchInvites } from "../../native/network";
import type { LocalCommand } from "../../native/localGame";
import { createVisitClient } from "../../realtime/visitClient";
import type { VisitClient } from "../../realtime/visitClient";

type View = { phase: "local" | "connecting" | "host" | "guest" | "error"; error?: string; members: string[] };
const roomKey = (deviceId: string) => ["room", "mine", SERVER_ORIGIN, deviceId] as const;
export function useMultiplayer() {
  const [view, setView] = useState<View>({ phase: "local", members: [] });
  const client = useRef<VisitClient | undefined>(undefined);
  const current = useRef<Snapshot | undefined>(undefined);
  const listeners = useRef(new Set<(snapshot: Snapshot) => void>());
  const live = useRef(false);
  const session = useRef<Session | undefined>(undefined);
  const operation = useRef<Promise<void> | undefined>(undefined);
  const pendingInvite = useRef<string | undefined>(undefined);
  const everConnected = useRef(false);
  const mode = useRef<"host" | "guest">("host");
  const abort = useRef<AbortController | undefined>(undefined);
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>();
  const room = useQuery({ queryKey: roomKey(deviceId ?? "pending"), enabled: deviceId !== undefined,
    queryFn: ({ signal }) => { if (session.current === undefined) throw new Error("UNAUTHORIZED"); return getRoom(session.current, signal); }, retry: false, staleTime: Infinity });

  function report(error: unknown): void {
    if (!live.current) return;
    client.current?.dispose(); client.current = undefined; current.current = undefined;
    setView({ phase: "error", error: error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST, members: [] });
    if (everConnected.current) void publishNetwork({ mode: "offline", snapshot: null }).catch(() => {});
  }
  function receive(snapshot: Snapshot): void {
    if (!live.current) return;
    current.current = snapshot;
    for (const listener of listeners.current) listener(snapshot);
    const names = snapshot.members.map((member) => `${member.role === "host" ? "호스트" : "방문자"} · ${member.nickname}`);
    setView((previous) => previous.members.join("\n") === names.join("\n") ? previous : { ...previous, members: names });
    void publishNetwork({ mode: mode.current, snapshot }).catch((error: unknown) => report(error));
  }
  async function authenticate(nickname: string): Promise<Session> {
    if (session.current !== undefined && session.current.expiresAt - Date.now() > 60000) return session.current;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const credential = await readCredential(SERVER_ORIGIN);
    let result: Session;
    if (credential !== undefined) result = await restoreDevice(credential, controller.signal);
    else {
      const registered = await registerDevice(nickname, controller.signal);
      // Persist before hosting. A storage failure must not silently leave an unrecoverable identity.
      await storeCredential(SERVER_ORIGIN, { deviceId: registered.deviceId, secret: registered.secret });
      result = { deviceId: registered.deviceId, accessToken: registered.accessToken, expiresAt: registered.expiresAt };
    }
    if (!live.current) throw new Error("Connection cancelled");
    session.current = result; setDeviceId(result.deviceId); return result;
  }
  async function enter(token: string | undefined, nickname: string): Promise<void> {
    if (operation.current !== undefined) { pendingInvite.current = token ?? pendingInvite.current; return operation.current; }
    const task = (async () => {
      try {
        setView({ phase: "connecting", members: [] });
        client.current?.dispose(); client.current = undefined;
        const auth = await authenticate(nickname);
        if (!live.current) return;
        mode.current = token === undefined ? "host" : "guest";
        const connection = createVisitClient(auth, receive, (message) => report(new Error(message)));
        client.current = connection;
        await connection.connect();
        if (!live.current) { connection.dispose(); return; }
        const joined: Joined = token === undefined
          ? await connection.enter("room:host", { version: 1, bounds: await hostBounds() })
          : await connection.enter("visit:join", { version: 1, token });
        everConnected.current = true;
        if (live.current) setView((previous) => ({ ...previous, phase: joined.role }));
      } catch (error) { report(error); throw error; }
    })();
    operation.current = task;
    try { await task; }
    finally {
      operation.current = undefined;
      const pending = pendingInvite.current; pendingInvite.current = undefined;
      if (live.current && pending !== undefined && pending !== token) void enter(pending, nickname).catch(() => {});
    }
  }
  const connect = useMutation({ mutationFn: (nickname: string) => enter(undefined, nickname), retry: false });
  const join = useMutation({ mutationFn: ({ link, nickname }: { link: string; nickname: string }) => {
    let token: string;
    try { token = parseInviteLink(link, SERVER_ORIGIN); } catch { throw new Error(ERROR_MESSAGES.INVALID_INVITE); }
    return enter(token, nickname);
  }, retry: false });
  const returning = useMutation({ mutationFn: async () => {
    try { await client.current?.leave(); await enter(undefined, "친구"); }
    catch (error) { report(error); throw error; }
  }, retry: false });
  const invite = useMutation({ mutationFn: async () => { if (session.current === undefined) throw new Error("먼저 내 공간을 연결해 주세요."); return rotateInvite(session.current); }, retry: false });
  const revoke = useMutation({ mutationFn: async () => { if (session.current === undefined) throw new Error("UNAUTHORIZED"); return revokeInvite(session.current); }, onSuccess: () => invite.reset(), retry: false });

  const acceptInvite = useEffectEvent((link: string) => {
    try { const token = parseInviteLink(link, SERVER_ORIGIN); void enter(token, "친구").catch(() => {}); }
    catch { setView((previous) => ({ ...previous, error: ERROR_MESSAGES.INVALID_INVITE })); }
  });
  const watchFailed = useEffectEvent((error: unknown) => report(error));
  const subscribe = useCallback((listener: (snapshot: Snapshot) => void): (() => void) => {
    listeners.current.add(listener); if (current.current !== undefined) listener(current.current);
    return () => { listeners.current.delete(listener); };
  }, []);
  useEffect(() => {
    live.current = true;
    let active = true;
    const subscribers = listeners.current;
    let stop: (() => void) | undefined;
    void watchInvites((link) => { if (active) acceptInvite(link); })
      .then((unlisten) => { if (active) stop = unlisten; else unlisten(); }).catch((error: unknown) => { if (active) watchFailed(error); });
    return () => {
      active = false; live.current = false; abort.current?.abort(); stop?.(); client.current?.dispose(); client.current = undefined;
      session.current = undefined; current.current = undefined; subscribers.clear();
      queryClient.removeQueries({ queryKey: ["room"] });
    };
  }, [queryClient]);
  return { view, room, connect, join, returning, invite, revoke,
    input(command: LocalCommand): void { client.current?.input(command); },
    subscribe,
  };
}
