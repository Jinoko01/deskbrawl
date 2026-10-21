import { io } from "socket.io-client";
import { commandAckSchema, errorSchema, ERROR_MESSAGES, joinedAckSchema, snapshotSchema } from "@deskbrawl/protocol";
import type { Joined, Session, Snapshot } from "@deskbrawl/protocol";
import type { LocalCommand } from "../native/localGame";
import { SERVER_ORIGIN } from "../api/rooms";

export function createVisitClient(session: Session, onSnapshot: (snapshot: Snapshot) => void, onEnded: (message: string) => void) {
  const socket = io(SERVER_ORIGIN, { autoConnect: false, transports: ["websocket"], reconnection: false,
    auth: { version: 1, token: session.accessToken }, timeout: 5000 });
  let membership: Joined | undefined;
  let sequence = 0;
  let movement = { x: 0, y: 0 } as LocalCommand["movement"];
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let connectingReject: ((reason: Error) => void) | undefined;
  function fail(message: string): void {
    if (disposed) return;
    membership = undefined; movement = { x: 0, y: 0 };
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    onEnded(message);
  }
  socket.on("world:snapshot", (body: unknown) => {
    const result = snapshotSchema.safeParse(body);
    if (!result.success) { fail("서버 게임 상태가 올바르지 않습니다."); socket.disconnect(); return; }
    if (membership === undefined || result.data.worldId !== membership.worldId || result.data.roomId !== membership.roomId) return;
    if (result.data.world.tick <= membership.snapshot.world.tick) return;
    membership = { ...membership, snapshot: result.data };
    onSnapshot(result.data);
  });
  socket.on("room:closed", (body: unknown) => { const parsed = errorSchema.safeParse(body); fail(parsed.success ? ERROR_MESSAGES[parsed.data.code] : ERROR_MESSAGES.SESSION_ENDED); });
  socket.on("disconnect", () => fail(ERROR_MESSAGES.CONNECTION_LOST));
  function acknowledge(event: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!socket.connected || disposed) { reject(new Error(ERROR_MESSAGES.CONNECTION_LOST)); return; }
      socket.timeout(5000).emit(event, body, (error: Error | null, result: unknown) => {
        if (error !== null) reject(new Error("서버 응답을 확인하지 못했습니다. 다시 연결해 주세요."));
        else resolve(result);
      });
    });
  }
  async function command(event: string, body: unknown): Promise<void> {
    const result = commandAckSchema.parse(await acknowledge(event, body));
    if (!result.ok) throw new Error(ERROR_MESSAGES[result.code]);
  }
  function sendMovement(): void {
    if (membership === undefined || !socket.connected) return;
    const visitId = membership.visitId;
    void command("player:input", { visitId, seq: ++sequence, movement }).catch((error: unknown) => fail(error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST));
  }
  return {
    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        connectingReject = reject;
        socket.once("connect", () => { connectingReject = undefined; resolve(); });
        socket.once("connect_error", () => { connectingReject = undefined; reject(new Error("서버에 연결하지 못했습니다. 서버 실행 상태와 주소를 확인해 주세요.")); });
        socket.connect();
      });
    },
    async enter(event: "room:host" | "visit:join", body: unknown): Promise<Joined> {
      const result = joinedAckSchema.parse(await acknowledge(event, body));
      if (!result.ok) throw new Error(ERROR_MESSAGES[result.code]);
      membership = result; sequence = 0; movement = { x: 0, y: 0 }; onSnapshot(result.snapshot);
      if (timer !== undefined) clearInterval(timer);
      timer = setInterval(sendMovement, 50);
      return result;
    },
    input(input: LocalCommand): void {
      if (membership === undefined) return;
      movement = input.kind === "input" ? input.movement : { x: 0, y: 0 };
      // A focus loss must reach the server immediately; held input is refreshed by the 20 Hz timer.
      if (input.kind === "work") sendMovement();
      if (input.kind === "input" && input.action !== undefined) {
        sendMovement();
        void command("player:action", { visitId: membership.visitId, actionId: crypto.randomUUID(), action: input.action })
          .catch((error: unknown) => fail(error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST));
      }
    },
    async leave(): Promise<void> {
      const current = membership;
      movement = { x: 0, y: 0 };
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (current !== undefined) await command("visit:leave", { visitId: current.visitId });
      membership = undefined;
    },
    dispose(): void {
      disposed = true; membership = undefined;
      connectingReject?.(new Error("Connection cancelled")); connectingReject = undefined;
      if (timer !== undefined) clearInterval(timer);
      socket.removeAllListeners(); socket.disconnect();
    },
  };
}
export type VisitClient = ReturnType<typeof createVisitClient>;
