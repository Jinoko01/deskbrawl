import { randomUUID } from "node:crypto";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import { snapshotSchema } from "@deskbrawl/protocol";
import { createSnapshotView, networkScene } from "./networkScene";
import type { CharacterSceneSnapshot } from "./characterScene";

function fixture() {
  const playerId = randomUUID();
  const world = createWorld({
    bounds: { width: 1280, height: 720 },
    rules: {
      tickMs: 50,
      moveSpeedUnitsPerSecond: 240,
      playerRadius: 24,
      combat: DEFAULT_COMBAT,
    },
    players: [{ id: playerId, position: { x: 100, y: 100 } }],
  });
  return snapshotSchema.parse({
    version: 2,
    roomId: randomUUID(),
    worldId: randomUUID(),
    world,
    members: [{ playerId, nickname: "모찌", role: "host" }],
    lastProcessedSeq: { [playerId]: 0 },
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("network presentation", () => {
  it("shows six named characters and fades live two-line drafts by local elapsed time", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const time = vi.spyOn(performance, "now").mockReturnValue(100);
    const first = fixture();
    const ids = Array.from({ length: 6 }, () => randomUUID());
    const full = snapshotSchema.parse({
      ...first,
      world: createWorld({ bounds: first.world.bounds, rules: { ...first.world.rules, combat: DEFAULT_COMBAT }, players: ids.map((id, i) => ({ id, position: { x: 100 + i * 100, y: 300 } })) }),
      members: ids.map((playerId, i) => ({ playerId, nickname: `친구${i}`, role: i === 0 ? "host" : "guest" })),
      lastProcessedSeq: Object.fromEntries(ids.map((id) => [id, 0])),
      chats: [{
        playerId: ids[0], current: "현재 줄", previous: "이전 줄", updatedAt: 123456789,
      }],
    });
    const render = vi.fn<(scene: CharacterSceneSnapshot) => void>();
    const buffer = createSnapshotView(render);
    buffer.receive(full);
    expect(render.mock.lastCall?.[0].characters).toHaveLength(6);
    expect(new Set(render.mock.lastCall?.[0].characters.map((frame) => frame.nickname)).size).toBe(6);
    expect(render.mock.lastCall?.[0].characters[0]?.chat).toEqual({ current: "현재 줄", previous: "이전 줄", opacity: 1 });
    time.mockReturnValue(5200);
    buffer.receive(full);
    expect(render.mock.lastCall?.[0].characters[0]?.chat?.opacity).toBe(0.5);
    buffer.receive({ ...full, chats: [] });
    expect(render.mock.lastCall?.[0].characters[0]?.chat).toBeUndefined();
    buffer.dispose();
    time.mockRestore();
  });
  it("removes departed characters even when membership changes without advancing a tick", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const render = vi.fn<(scene: CharacterSceneSnapshot) => void>();
    const buffer = createSnapshotView(render);
    const first = fixture();
    buffer.receive(first);
    buffer.receive({ ...first, members: [], world: { ...first.world, players: [] } });
    expect(render.mock.calls.at(-1)?.[0].characters).toEqual([]);
    buffer.dispose();
  });
  it("keeps authoritative stun and hit IDs without calculating combat on the client", () => {
    const initial = fixture();
    const player = initial.world.players[0];
    if (player === undefined) {
      throw new Error("Missing fixture player");
    }
    const snapshot = {
      ...initial,
      world: {
        ...initial.world,
        tick: 4,
        players: [{
          ...player,
          lastHitTick: 3,
          knockbackUntilTick: 5,
          stunnedUntilTick: 10,
        }],
      },
    };
    expect(networkScene(snapshot).characters[0]?.motion).toEqual({ kind: "hit", actionId: `${player.id}:hit:3` });
    expect(networkScene({ ...snapshot, world: { ...snapshot.world, tick: 6 } }).characters[0]?.motion).toEqual({ kind: "stun" });
    expect(networkScene(snapshot).characters[0]?.skin).toBe("mochi");
  });
  it("rejects old ticks, accepts fresh worlds, avoids idle redraws and cancels interpolation", () => {
    const render = vi.fn<(scene: CharacterSceneSnapshot) => void>();
    const request = vi.fn(() => 1);
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const buffer = createSnapshotView(render);
    const first = fixture();
    buffer.receive(first);
    buffer.receive({ ...first, world: { ...first.world, tick: 1 } });
    buffer.receive(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    const player = first.world.players[0];
    if (player === undefined) {
      throw new Error("Missing fixture player");
    }
    buffer.receive({ ...first, world: { ...first.world, tick: 2, players: [{ ...player, position: { x: 120, y: 100 } }] } });
    expect(request).toHaveBeenCalledOnce();
    buffer.receive({ ...fixture(), world: { ...first.world, tick: 0 } });
    expect(render.mock.calls.at(-1)?.[0].characters[0]?.position.x).toBe(100);
    buffer.dispose();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it("redraws HP changes without movement and shows knockout until the server restores HP", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const render = vi.fn<(scene: CharacterSceneSnapshot) => void>();
    const buffer = createSnapshotView(render);
    const initial = fixture();
    buffer.receive(initial);
    const updated = (hp: number) => ({
      ...initial,
      world: { ...initial.world, tick: 1, players: initial.world.players.map((player) => ({ ...player, hp })) },
    });
    buffer.receive(updated(47));
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.lastCall?.[0].characters[0]?.hp).toBe(47);
    buffer.receive(updated(0));
    expect(render.mock.lastCall?.[0].characters[0]).toMatchObject({ hp: 0, motion: { kind: "stun" } });
    buffer.receive(updated(50));
    expect(render.mock.lastCall?.[0].characters[0]).toMatchObject({ hp: 50, motion: { kind: "idle" } });
    buffer.dispose();
  });
});
