import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import { snapshotSchema } from "@deskbrawl/protocol";
import { createSnapshotView, networkScene } from "./networkScene";

function fixture() {
  const playerId = randomUUID();
  const world = createWorld({ bounds: { width: 1280, height: 720 },
    rules: { tickMs: 50, moveSpeedUnitsPerSecond: 240, playerRadius: 24, combat: DEFAULT_COMBAT },
    players: [{ id: playerId, position: { x: 100, y: 100 } }] });
  return snapshotSchema.parse({ version: 1, roomId: randomUUID(), worldId: randomUUID(), world,
    members: [{ playerId, nickname: "모찌", role: "host" }], lastProcessedSeq: { [playerId]: 0 } });
}
afterEach(() => vi.unstubAllGlobals());
describe("network presentation", () => {
  it("keeps authoritative stun and hit IDs without calculating combat on the client", () => {
    const initial = fixture();
    const player = initial.world.players[0];
    if (player === undefined) throw new Error("Missing fixture player");
    const snapshot = { ...initial, world: { ...initial.world, tick: 4, players: [{ ...player, lastHitTick: 3, knockbackUntilTick: 5, stunnedUntilTick: 10 }] } };
    expect(networkScene(snapshot).characters[0]?.motion).toEqual({ kind: "hit", actionId: `${player.id}:hit:3` });
    expect(networkScene({ ...snapshot, world: { ...snapshot.world, tick: 6 } }).characters[0]?.motion).toEqual({ kind: "stun" });
    expect(networkScene(snapshot).characters[0]?.skin).toBe("mochi");
  });
  it("rejects old ticks, accepts fresh worlds, avoids idle redraws and cancels interpolation", () => {
    const render = vi.fn();
    const request = vi.fn(() => 1), cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", request); vi.stubGlobal("cancelAnimationFrame", cancel);
    const buffer = createSnapshotView(render), first = fixture();
    buffer.receive(first);
    buffer.receive({ ...first, world: { ...first.world, tick: 1 } });
    buffer.receive(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    const player = first.world.players[0];
    if (player === undefined) throw new Error("Missing fixture player");
    buffer.receive({ ...first, world: { ...first.world, tick: 2, players: [{ ...player, position: { x: 120, y: 100 } }] } });
    expect(request).toHaveBeenCalledOnce();
    buffer.receive({ ...fixture(), world: { ...first.world, tick: 0 } });
    expect(render.mock.calls.at(-1)?.[0].characters[0].position.x).toBe(100);
    buffer.dispose(); expect(cancel).toHaveBeenCalledWith(1);
  });
});
