import { io } from "socket.io-client";
import {
  commandAckSchema,
  errorSchema,
  ERROR_MESSAGES,
  joinedAckSchema,
  snapshotSchema,
  hostSchema,
  joinSchema,
  resumeSchema,
  PROTOCOL_VERSION,
} from "@deskbrawl/protocol";
import type { Joined, Session, Snapshot } from "@deskbrawl/protocol";
import type { LocalCommand } from "../native/localGame";
import { SERVER_ORIGIN } from "../api/rooms";

export function createVisitClient(session: Session, onSnapshot: (snapshot: Snapshot) => void, onEnded: (message: string) => void,
  onRecovery: (state: "reconnecting" | "recovered") => void = () => { /* Optional outside the desktop session. */ }) {
  const socket = io(SERVER_ORIGIN, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 3,
    reconnectionDelay: 500,
    reconnectionDelayMax: 1500,
    auth: { version: PROTOCOL_VERSION, token: session.accessToken },
    timeout: 5000,
  });
  let membership: Joined | undefined;
  let sequence = 0;
  let movement = { x: 0, y: 0 } as LocalCommand["movement"];
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let connectingReject: ((reason: Error) => void) | undefined;
  let paused = false;
  let inputEpoch = 0;
  let recovering = false;
  let restoring = false;
  let focused = false;
  let chatSequence = 0;
  let draft: { current: string; previous: string } | undefined;
  let sendingChat = false;
  function dispose(): void {
    disposed = true;
    draft = undefined;
    membership = undefined;
    connectingReject?.(new Error("Connection cancelled"));
    connectingReject = undefined;
    if (timer !== undefined) {
      clearInterval(timer);
    }
    socket.removeAllListeners();
    socket.io.off("reconnect_failed", reconnectFailed);
    socket.disconnect();
  }
  function fail(message: string): void {
    if (disposed) {
      return;
    }
    movement = { x: 0, y: 0 };
    dispose();
    onEnded(message);
  }
  socket.on("world:snapshot", (body: unknown) => {
    const result = snapshotSchema.safeParse(body);
    if (!result.success) {
      fail("서버 게임 상태가 올바르지 않습니다.");
      socket.disconnect();
      return;
    }
    if (recovering) {
      return;
    }
    if (result.data.worldId !== membership?.worldId || result.data.roomId !== membership.roomId) {
      return;
    }
    if (result.data.world.tick < membership.snapshot.world.tick) {
      return;
    }
    membership = { ...membership, snapshot: result.data };
    onSnapshot(result.data);
  });
  socket.on("room:closed", (body: unknown) => {
    const parsed = errorSchema.safeParse(body);
    fail(parsed.success ? ERROR_MESSAGES[parsed.data.code] : ERROR_MESSAGES.SESSION_ENDED);
  });
  const reconnectFailed = () => fail(ERROR_MESSAGES.CONNECTION_LOST);
  socket.io.on("reconnect_failed", reconnectFailed);
  socket.on("connect_error", () => {
    // Namespace authentication denial does not trigger Socket.IO's retry loop.
    if (recovering && !socket.active) {
      fail(ERROR_MESSAGES.CONNECTION_LOST);
    }
  });
  socket.on("disconnect", (reason: string) => {
    if (disposed) {
      return;
    }
    if (membership === undefined || reason === "io server disconnect") {
      fail(ERROR_MESSAGES.CONNECTION_LOST);
      return;
    }
    pauseInput();
    draft = undefined;
    sendingChat = false;
    restoring = false;
    clearInterval(timer);
    timer = undefined;
    recovering = true;
    onRecovery("reconnecting");
  });
  socket.on("connect", () => {
    if (!recovering || restoring || membership === undefined || disposed) {
      return;
    }
    restoring = true;
    const previous = membership;
    const epoch = inputEpoch;
    void (async () => {
      const result = joinedAckSchema.parse(await acknowledge("visit:resume", resumeSchema.parse({
        version: PROTOCOL_VERSION, visitId: previous.visitId, resumeToken: previous.resumeToken,
      })));
      if (disposed || epoch !== inputEpoch) {
        return;
      }
      if (!result.ok) {
        throw new Error(ERROR_MESSAGES[result.code]);
      }
      if (result.worldId !== previous.worldId || result.roomId !== previous.roomId || result.playerId !== previous.playerId) {
        throw new Error(ERROR_MESSAGES.SESSION_ENDED);
      }
      membership = result;
      sequence = 0;
      chatSequence = 0;
      movement = { x: 0, y: 0 };
      paused = focused;
      recovering = false;
      onSnapshot(result.snapshot);
      onRecovery("recovered");
      clearInterval(timer);
      timer = setInterval(refresh, 50);
    })().catch((error: unknown) => {
      if (epoch === inputEpoch) {
        fail(error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST);
      }
    }).finally(() => {
      if (epoch === inputEpoch) {
        restoring = false;
      }
    });
  });
  function acknowledge(event: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!socket.connected || disposed) {
        reject(new Error(ERROR_MESSAGES.CONNECTION_LOST));
        return;
      }
      socket.timeout(5000).emit(event, body, (error: Error | null, result: unknown) => {
        if (error !== null) {
          reject(new Error("서버 응답을 확인하지 못했습니다. 다시 연결해 주세요."));
        } else {
          resolve(result);
        }
      });
    });
  }
  async function command(event: string, body: unknown): Promise<void> {
    const result = commandAckSchema.parse(await acknowledge(event, body));
    if (!result.ok) {
      throw new Error(ERROR_MESSAGES[result.code]);
    }
  }
  function sendMovement(): void {
    if (membership === undefined || !socket.connected || paused) {
      return;
    }
    const visitId = membership.visitId;
    const epoch = inputEpoch;
    void command("player:input", { visitId, seq: ++sequence, movement }).catch((error: unknown) => {
      if (epoch === inputEpoch) {
        fail(error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST);
      }
    });
  }
  function pauseInput(): void {
    paused = true;
    inputEpoch++;
    movement = { x: 0, y: 0 };
  }
  function refresh(): void {
    sendMovement();
    if (membership === undefined || !socket.connected || recovering || sendingChat || draft === undefined) {
      return;
    }
    const text = draft;
    draft = undefined;
    const epoch = inputEpoch;
    sendingChat = true;
    void command("player:chat", { visitId: membership.visitId, seq: ++chatSequence, ...text })
      .catch(() => {
        if (epoch === inputEpoch) {
          fail(ERROR_MESSAGES.CONNECTION_LOST);
        }
      }).finally(() => {
        sendingChat = false;
      });
  }
  function hostControl() {
    if (membership?.role !== "host" || disposed) {
      throw new Error(ERROR_MESSAGES.UNAUTHORIZED);
    }
    return { visitId: membership.visitId, commandId: crypto.randomUUID() };
  }
  return {
    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        connectingReject = reject;
        socket.once("connect", () => {
          connectingReject = undefined;
          resolve();
        });
        socket.once("connect_error", () => {
          connectingReject = undefined;
          reject(new Error("서버에 연결하지 못했습니다. 서버 실행 상태와 주소를 확인해 주세요."));
        });
        socket.connect();
      });
    },
    async enter(event: "room:host" | "visit:join", body: unknown): Promise<Joined> {
      const request = event === "room:host" ? hostSchema.parse(body) : joinSchema.parse(body);
      const result = joinedAckSchema.parse(await acknowledge(event, request));
      if (disposed) {
        throw new Error(ERROR_MESSAGES.CONNECTION_LOST);
      }
      if (!result.ok) {
        throw new Error(ERROR_MESSAGES[result.code]);
      }
      membership = result;
      sequence = 0;
      movement = { x: 0, y: 0 };
      focused = "focused" in request && request.focused === true;
      paused = focused;
      onSnapshot(result.snapshot);
      if (timer !== undefined) {
        clearInterval(timer);
      }
      timer = setInterval(refresh, 50);
      return result;
    },
    input(input: LocalCommand): void {
      if (membership === undefined || paused) {
        return;
      }
      movement = input.kind === "input" ? input.movement : { x: 0, y: 0 };
      // A focus loss must reach the server immediately; held input is refreshed by the 20 Hz timer.
      if (input.kind === "work") {
        sendMovement();
      }
      if (input.kind === "input" && input.action !== undefined) {
        sendMovement();
        const epoch = inputEpoch;
        void command("player:action", { visitId: membership.visitId, actionId: crypto.randomUUID(), action: input.action })
          .catch((error: unknown) => {
            if (epoch === inputEpoch) {
              fail(error instanceof Error ? error.message : ERROR_MESSAGES.CONNECTION_LOST);
            }
          });
      }
    },
    async leave(): Promise<void> {
      const current = membership;
      pauseInput();
      recovering = false;
      draft = undefined;
      membership = undefined;
      if (timer !== undefined) {
        clearInterval(timer);
      }
      timer = undefined;
      if (current !== undefined) {
        await command("visit:leave", { visitId: current.visitId });
      }
      membership = undefined;
    },
    playerId: (): string | undefined => membership?.playerId,
    chat(current: string, previous: string): void {
      if (disposed || membership === undefined || recovering || !socket.connected) {
        return;
      }
      draft = { current: current.slice(0, 50), previous: previous.slice(0, 50) };
    },
    pauseInput,
    async setFocused(nextFocused: boolean): Promise<void> {
      const control = hostControl();
      pauseInput();
      await command("room:focus", { ...control, focused: nextFocused });
      if (!disposed) {
        focused = nextFocused;
        paused = nextFocused;
      }
    },
    kick(targetPlayerId: string): Promise<void> {
      return command("visit:kick", { ...hostControl(), targetPlayerId });
    },
    clearVisitors(): Promise<void> {
      return command("visit:clear", hostControl());
    },
    dispose,
  };
}
export type VisitClient = ReturnType<typeof createVisitClient>;
