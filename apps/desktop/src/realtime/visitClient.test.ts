import { randomUUID } from "node:crypto";
import {
  afterEach, beforeEach, expect, it, vi,
} from "vitest";
import { createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import { ERROR_MESSAGES, joinedSchema } from "@deskbrawl/protocol";
import { createVisitClient } from "./visitClient";
import type { VisitClient } from "./visitClient";

const transport = vi.hoisted(() => {
  type Reply = (error: Error | null, body: unknown) => void;
  const listeners = new Map<string, (body: unknown) => void>();
  const sent: { event: string; body: unknown; reply: Reply }[] = [];
  const emit = vi.fn((event: string, body: unknown, reply: Reply) => sent.push({ event, body, reply }));
  return {
    listeners,
    sent,
    socket: {
      connected: true,
      on: vi.fn((event: string, listener: (body: unknown) => void) => listeners.set(event, listener)),
      once: vi.fn((event: string, listener: (body: unknown) => void) => listeners.set(event, listener)),
      timeout: vi.fn(() => ({ emit })),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(() => listeners.clear()),
    },
  };
});
vi.mock("socket.io-client", () => ({ io: () => transport.socket }));

const clients: VisitClient[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  transport.sent.length = 0;
  transport.listeners.clear();
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose());
  vi.useRealTimers();
});
function pending(event: string) {
  const command = [...transport.sent].reverse().find((entry) => entry.event === event);
  if (command === undefined) {
    throw new Error(`Missing ${event} command`);
  }
  return command;
}
async function host(focused = false) {
  const playerId = randomUUID();
  const guestId = randomUUID();
  const world = createWorld({
    bounds: { width: 1280, height: 720 },
    rules: {
      tickMs: 50, moveSpeedUnitsPerSecond: 240, playerRadius: 24, combat: DEFAULT_COMBAT,
    },
    players: [{ id: playerId, position: { x: 100, y: 100 } }, { id: guestId, position: { x: 244, y: 100 } }],
  });
  const roomId = randomUUID();
  const worldId = randomUUID();
  const joined = joinedSchema.parse({
    ok: true,
    roomId,
    worldId,
    visitId: randomUUID(),
    playerId,
    role: "host",
    snapshot: {
      version: 1,
      roomId,
      worldId,
      world: { ...world, tick: 3 },
      members: [{ playerId, nickname: "호스트", role: "host" }, { playerId: guestId, nickname: "방문자", role: "guest" }],
      lastProcessedSeq: { [playerId]: 0, [guestId]: 0 },
    },
  });
  const receive = vi.fn();
  const ended = vi.fn();
  const client = createVisitClient({ deviceId: playerId, accessToken: "test", expiresAt: Date.now() + 3600000 }, receive, ended);
  clients.push(client);
  const entering = client.enter("room:host", { version: 1, bounds: world.bounds, focused });
  pending("room:host").reply(null, joined);
  await entering;
  return {
    client, joined, receive, ended, guestId,
  };
}

it("hosts in focus without refreshing input, then resumes with zero movement", async () => {
  const { client, joined } = await host(true);
  client.input({
    kind: "input", seq: 1, movement: { x: 1, y: 0 }, action: "stone",
  });
  await vi.advanceTimersByTimeAsync(150);
  expect(transport.sent.map((command) => command.event)).toEqual(["room:host"]);
  const resuming = client.setFocused(false);
  expect(pending("room:focus").body).toMatchObject({ visitId: joined.visitId, focused: false });
  pending("room:focus").reply(null, { ok: true });
  await resuming;
  await vi.advanceTimersByTimeAsync(50);
  expect(pending("player:input").body).toMatchObject({ seq: 1, movement: { x: 0, y: 0 } });
});

it("ignores obsolete input failures while focus is being applied and uses unique control IDs", async () => {
  const { client, ended, guestId } = await host();
  client.input({ kind: "input", seq: 1, movement: { x: 1, y: 0 } });
  await vi.advanceTimersByTimeAsync(50);
  const stale = pending("player:input");
  const focusing = client.setFocused(true);
  stale.reply(null, { ok: false, code: "ROOM_UNAVAILABLE" });
  pending("room:focus").reply(null, { ok: true });
  await focusing;
  expect(ended).not.toHaveBeenCalled();
  const kicking = client.kick(guestId);
  const kick = pending("visit:kick");
  expect(kick.body).toMatchObject({ targetPlayerId: guestId });
  kick.reply(null, { ok: true });
  await kicking;
  const clearing = client.clearVisitors();
  const clear = pending("visit:clear");
  expect(clear.body).not.toEqual(kick.body);
  clear.reply(null, { ok: true });
  await clearing;
});

it("clears membership and timers on a kick and reports the termination reason once", async () => {
  const { client, ended } = await host();
  transport.listeners.get("room:closed")?.({ ok: false, code: "KICKED" });
  client.input({
    kind: "input", seq: 1, movement: { x: 1, y: 0 }, action: "stone",
  });
  await vi.advanceTimersByTimeAsync(150);
  expect(ended).toHaveBeenCalledExactlyOnceWith(ERROR_MESSAGES.KICKED);
  expect(transport.sent).toHaveLength(1);
  expect(transport.socket.disconnect).toHaveBeenCalledOnce();
});

it("accepts membership changes at the current tick but rejects older snapshots", async () => {
  const { joined, receive } = await host();
  const snapshot = {
    ...joined.snapshot,
    members: joined.snapshot.members.filter((member) => member.role === "host"),
    world: { ...joined.snapshot.world, players: joined.snapshot.world.players.filter((player) => player.id === joined.playerId) },
  };
  transport.listeners.get("world:snapshot")?.(snapshot);
  expect(receive).toHaveBeenLastCalledWith(snapshot);
  transport.listeners.get("world:snapshot")?.({ ...snapshot, world: { ...snapshot.world, tick: 2 } });
  expect(receive).toHaveBeenCalledTimes(2);
});
