import { randomUUID } from "node:crypto";
import {
  afterEach, beforeEach, expect, it, vi,
} from "vitest";
import { createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import { ERROR_MESSAGES, joinedSchema } from "@deskbrawl/protocol";
import type { Snapshot } from "@deskbrawl/protocol";
import { createVisitClient } from "./visitClient";
import type { VisitClient } from "./visitClient";

const transport = vi.hoisted(() => {
  type Reply = (error: Error | null, body: unknown) => void;
  const listeners = new Map<string, (body: unknown) => void>();
  const sent: { event: string; body: unknown; reply: Reply }[] = [];
  const manager = new Map<string, () => void>();
  const emit = vi.fn((event: string, body: unknown, reply: Reply) => sent.push({ event, body, reply }));
  return {
    listeners,
    sent,
    manager,
    socket: {
      connected: true,
      on: vi.fn((event: string, listener: (body: unknown) => void) => listeners.set(event, listener)),
      once: vi.fn((event: string, listener: (body: unknown) => void) => listeners.set(event, listener)),
      timeout: vi.fn(() => ({ emit })),
      connect: vi.fn(),
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(() => listeners.clear()),
      io: { on: vi.fn((event: string, fn: () => void) => manager.set(event, fn)), off: vi.fn((event: string) => manager.delete(event)) },
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
  transport.manager.clear();
  transport.socket.connected = true;
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
    resumeToken: "a".repeat(43),
    playerId,
    role: "host",
    snapshot: {
      version: 2,
      roomId,
      worldId,
      world: { ...world, tick: 3 },
      members: [{ playerId, nickname: "호스트", role: "host" }, { playerId: guestId, nickname: "방문자", role: "guest" }],
      lastProcessedSeq: { [playerId]: 0, [guestId]: 0 },
    },
  });
  const receive = vi.fn<(snapshot: Snapshot) => void>();
  const ended = vi.fn();
  const recovery = vi.fn();
  const client = createVisitClient({ deviceId: playerId, accessToken: "test", expiresAt: Date.now() + 3600000 }, receive, ended, recovery);
  clients.push(client);
  const entering = client.enter("room:host", { version: 2, bounds: world.bounds, focused });
  pending("room:host").reply(null, joined);
  await entering;
  return {
    client, joined, receive, ended, guestId, recovery,
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

it("resumes the same world with a rotated visit and full snapshot, discarding held keys and stale errors", async () => {
  const {
    client, joined, ended, recovery, receive,
  } = await host();
  client.input({
    kind: "input", seq: 1, movement: { x: 1, y: 0 }, action: "stone",
  });
  const stale = pending("player:action");
  transport.socket.connected = false;
  transport.listeners.get("disconnect")?.("transport close");
  expect(recovery).toHaveBeenLastCalledWith("reconnecting");
  stale.reply(new Error("old connection"), undefined);
  await Promise.resolve();
  expect(ended).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  const count = transport.sent.length;
  client.input({
    kind: "input", seq: 2, movement: { x: 1, y: 0 }, action: "stone",
  });
  client.chat("offline draft", "");
  expect(transport.sent).toHaveLength(count);
  transport.socket.connected = true;
  transport.listeners.get("connect")?.(undefined);
  expect(pending("visit:resume").body).toEqual({ version: 2, visitId: joined.visitId, resumeToken: joined.resumeToken });
  const resumed = {
    ...joined, visitId: randomUUID(), resumeToken: "b".repeat(43), snapshot: { ...joined.snapshot, world: { ...joined.snapshot.world, tick: 99 } },
  };
  pending("visit:resume").reply(null, resumed);
  await vi.advanceTimersByTimeAsync(0);
  expect(recovery).toHaveBeenLastCalledWith("recovered");
  expect(receive).toHaveBeenLastCalledWith(resumed.snapshot);
  await vi.advanceTimersByTimeAsync(50);
  expect(pending("player:input").body).toMatchObject({ visitId: resumed.visitId, seq: 1, movement: { x: 0, y: 0 } });
  expect(transport.sent.filter((entry) => entry.event === "player:action")).toHaveLength(1);
  expect(transport.sent.filter((entry) => entry.event === "player:chat")).toHaveLength(0);
});

it("ends once after bounded reconnect failure and rejects a different world on resume", async () => {
  const { ended } = await host();
  transport.listeners.get("disconnect")?.("transport close");
  transport.manager.get("reconnect_failed")?.();
  transport.manager.get("reconnect_failed")?.();
  expect(ended).toHaveBeenCalledOnce();
  expect(transport.manager.has("reconnect_failed")).toBe(false);
  const next = await host();
  transport.listeners.get("disconnect")?.("transport close");
  transport.listeners.get("connect")?.(undefined);
  pending("visit:resume").reply(null, { ...next.joined, worldId: randomUUID() });
  await vi.advanceTimersByTimeAsync(0);
  expect(next.ended).toHaveBeenCalledOnce();
});

it("coalesces live drafts, clears them explicitly, and never replays offline text", async () => {
  const { client, joined } = await host();
  client.chat("ㅎ", "");
  client.chat("한글", "");
  await vi.advanceTimersByTimeAsync(50);
  expect(pending("player:chat").body).toEqual({
    visitId: joined.visitId, seq: 1, current: "한글", previous: "",
  });
  pending("player:chat").reply(null, { ok: true });
  await vi.advanceTimersByTimeAsync(0);
  client.chat("", "한글");
  await vi.advanceTimersByTimeAsync(50);
  pending("player:chat").reply(null, { ok: true });
  await vi.advanceTimersByTimeAsync(0);
  client.chat("", "");
  await vi.advanceTimersByTimeAsync(50);
  expect(pending("player:chat").body).toMatchObject({ seq: 3, current: "", previous: "" });
});

it("terminates recovery when the server refuses namespace authentication", async () => {
  const { ended } = await host();
  transport.listeners.get("disconnect")?.("transport close");
  transport.listeners.get("connect_error")?.(new Error("Unauthorized"));
  expect(ended).toHaveBeenCalledExactlyOnceWith(ERROR_MESSAGES.CONNECTION_LOST);
});

it("sends idle movement once, bounds in-flight input, and sends the latest stop after acknowledgement", async () => {
  const { client, ended } = await host();
  await vi.advanceTimersByTimeAsync(50);
  pending("player:input").reply(null, { ok: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(transport.sent.filter((entry) => entry.event === "player:input")).toHaveLength(1);
  client.input({ kind: "input", seq: 1, movement: { x: 1, y: 0 } });
  await vi.advanceTimersByTimeAsync(50);
  const moving = pending("player:input");
  await vi.advanceTimersByTimeAsync(200);
  expect(transport.sent.filter((entry) => entry.event === "player:input")).toHaveLength(2);
  client.input({ kind: "work", seq: 2, movement: { x: 0, y: 0 } });
  moving.reply(null, { ok: true });
  await vi.advanceTimersByTimeAsync(50);
  expect(pending("player:input").body).toMatchObject({ movement: { x: 0, y: 0 } });
  expect(ended).not.toHaveBeenCalled();
});

it("bounds attack bursts by the world cooldown and only sends changed movement before an action", async () => {
  const { client } = await host();
  for (let seq = 1; seq <= 100; seq++) {
    client.input({
      kind: "input", seq, movement: { x: 1, y: 0 }, action: "stone",
    });
  }
  expect(transport.sent.filter((entry) => entry.event === "player:action")).toHaveLength(1);
  expect(transport.sent.filter((entry) => entry.event === "player:input")).toHaveLength(1);
  pending("player:action").reply(null, { ok: true });
  await vi.advanceTimersByTimeAsync(900);
  client.input({
    kind: "input", seq: 101, movement: { x: 1, y: 0 }, action: "stone",
  });
  expect(transport.sent.filter((entry) => entry.event === "player:action")).toHaveLength(2);
});

it.each(["player:input", "player:action", "player:chat"])("keeps membership on a transient %s rate limit and resumes the latest movement without replaying attacks", async (event) => {
  const { client, ended } = await host();
  client.input({
    kind: "input", seq: 1, movement: { x: 1, y: 0 }, action: "stone",
  });
  client.chat("새 말", "");
  await vi.advanceTimersByTimeAsync(50);
  for (const entry of transport.sent.filter((entry) => entry.event.startsWith("player:"))) {
    entry.reply(null, entry.event === event ? { ok: false, code: "RATE_LIMITED" } : { ok: true });
  }
  await vi.advanceTimersByTimeAsync(0);
  const count = transport.sent.length;
  client.input({
    kind: "input", seq: 2, movement: { x: -1, y: 0 }, action: "stone",
  });
  await vi.advanceTimersByTimeAsync(900);
  expect(transport.sent).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(150);
  expect(pending("player:input").body).toMatchObject({ movement: { x: -1, y: 0 } });
  expect(transport.sent.filter((entry) => entry.event === "player:action")).toHaveLength(1);
  expect(ended).not.toHaveBeenCalled();
  expect(client.playerId()).toBeDefined();
});

it("merges room-scoped skins with legacy snapshots and changes the current member's profile", async () => {
  const { client, joined, receive } = await host();
  const saving = client.setProfile({ nickname: "새 이름", skin: "mint" });
  expect(pending("player:profile").body).toMatchObject({ visitId: joined.visitId, nickname: "새 이름", skin: "mint" });
  pending("player:profile").reply(null, { ok: true });
  await saving;
  const profiles = { roomId: joined.roomId, worldId: joined.worldId, profiles: [{ playerId: joined.playerId, skin: "mint" }] };
  transport.listeners.get("room:profiles")?.(profiles);
  expect(receive.mock.lastCall?.[0].members[0]?.skin).toBe("mint");
  transport.listeners.get("world:snapshot")?.(joined.snapshot);
  expect(receive.mock.lastCall?.[0].members[0]?.skin).toBe("mint");
  const count = receive.mock.calls.length;
  transport.listeners.get("room:profiles")?.({ ...profiles, worldId: randomUUID() });
  expect(receive).toHaveBeenCalledTimes(count);
});

it("resumes a paused visitor when a quick focus toggle is cancelled before changing rooms", async () => {
  const { client, joined } = await host();
  client.pauseInput();
  await vi.advanceTimersByTimeAsync(100);
  expect(transport.sent.filter((entry) => entry.event === "player:input")).toHaveLength(0);
  client.resumeInput();
  await vi.advanceTimersByTimeAsync(50);
  expect(pending("player:input").body).toMatchObject({ visitId: joined.visitId, movement: { x: 0, y: 0 } });
});
