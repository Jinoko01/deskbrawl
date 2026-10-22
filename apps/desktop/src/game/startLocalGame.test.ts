import { randomUUID } from "node:crypto";
import {
  afterEach, beforeEach, expect, it, vi,
} from "vitest";
import { createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import { snapshotSchema } from "@deskbrawl/protocol";
import type { Bridge, Snapshot } from "@deskbrawl/protocol";
import type { LocalCommand } from "../native/localGame";
import { startLocalGame } from "./startLocalGame";
import type { CharacterSceneSnapshot } from "./characterScene";

const bridge = vi.hoisted(() => ({
  receive: undefined as ((state: Bridge) => void) | undefined,
  command: undefined as ((command: LocalCommand | "stop") => void) | undefined,
  stopNetwork: vi.fn(),
  stopCommands: vi.fn(),
  skin: undefined as ((skin: "mochi" | "mint") => void) | undefined,
  stopSkin: vi.fn(),
}));
vi.mock("./characterPreference", () => ({
  watchCharacterSkin: vi.fn((receive: (skin: "mochi" | "mint") => void) => {
    bridge.skin = receive;
    receive("mochi");
    return bridge.stopSkin;
  }),
}));
vi.mock("../native/network", () => ({
  watchNetwork: vi.fn((receive: (state: Bridge) => void) => {
    bridge.receive = receive;
    return Promise.resolve(bridge.stopNetwork);
  }),
}));
vi.mock("../native/localGame", () => ({
  reportLocalReady: vi.fn(() => Promise.resolve()),
  watchLocalCommands: vi.fn((command: (command: LocalCommand | "stop") => void) => {
    bridge.command = command;
    return Promise.resolve(bridge.stopCommands);
  }),
}));

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  bridge.receive = undefined;
  bridge.command = undefined;
  bridge.skin = undefined;
  vi.clearAllMocks();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function snapshot(): Snapshot {
  const host = randomUUID();
  const guest = randomUUID();
  return snapshotSchema.parse({
    version: 2,
    roomId: randomUUID(),
    worldId: randomUUID(),
    world: createWorld({
      bounds: { width: 1920, height: 1080 },
      rules: {
        tickMs: 50, moveSpeedUnitsPerSecond: 240, playerRadius: 24, combat: DEFAULT_COMBAT,
      },
      players: [{ id: host, position: { x: 100, y: 100 } }, { id: guest, position: { x: 250, y: 100 } }],
    }),
    members: [{ playerId: host, role: "host", nickname: "호스트" }, { playerId: guest, role: "guest", nickname: "방문자" }],
    lastProcessedSeq: { [host]: 0, [guest]: 0 },
  });
}

it("renders the shared host and guest world on the desktop overlay and restores it after returning", async () => {
  const update = vi.fn<(scene: CharacterSceneSnapshot) => void>();
  const failure = vi.fn();
  stop = startLocalGame({ clientWidth: 1280, clientHeight: 720 } as HTMLElement, { update, dispose: vi.fn() }, failure);
  await vi.waitFor(() => expect(bridge.receive).toBeTypeOf("function"));
  const remote = snapshot();
  bridge.receive?.({ mode: "guest", snapshot: remote });
  expect(update.mock.lastCall?.[0]).toMatchObject({
    bounds: remote.world.bounds,
    characters: remote.world.players.map((player) => ({ id: player.id, position: player.position })),
  });
  bridge.receive?.({ mode: "host", snapshot: remote });
  expect(update.mock.lastCall?.[0].characters).toHaveLength(2);
  expect(failure).not.toHaveBeenCalled();
});

it.each(["local", "offline"] as const)("restores visible local characters immediately on %s after host closure, then accepts local PLAY", async (mode) => {
  const update = vi.fn<(scene: CharacterSceneSnapshot) => void>();
  stop = startLocalGame({ clientWidth: 1280, clientHeight: 720 } as HTMLElement, { update, dispose: vi.fn() }, vi.fn());
  await vi.waitFor(() => expect(bridge.receive).toBeTypeOf("function"));
  const initial = update.mock.calls[0]?.[0];
  bridge.receive?.({ mode: "guest", snapshot: snapshot() });
  bridge.receive?.({ mode, snapshot: null });
  expect(update.mock.lastCall?.[0]).toEqual(initial);
  bridge.command?.({ kind: "play", seq: 1, movement: { x: 0, y: 0 } });
  bridge.command?.({ kind: "input", seq: 2, movement: { x: 1, y: 0 } });
  await vi.advanceTimersByTimeAsync(150);
  expect(update.mock.lastCall?.[0].characters[0]?.position.x).toBeGreaterThan(initial?.characters[0]?.position.x ?? Infinity);
  stop();
  stop = undefined;
  expect(bridge.stopNetwork).toHaveBeenCalledOnce();
  expect(bridge.stopCommands).toHaveBeenCalledOnce();
});

it("keeps the shared world frozen during recovery and ignores local commands until the fresh snapshot", async () => {
  const update = vi.fn<(scene: CharacterSceneSnapshot) => void>();
  stop = startLocalGame({ clientWidth: 1280, clientHeight: 720 } as HTMLElement, { update, dispose: vi.fn() }, vi.fn());
  await vi.waitFor(() => expect(bridge.receive).toBeTypeOf("function"));
  const remote = snapshot();
  bridge.receive?.({ mode: "guest", snapshot: remote });
  bridge.receive?.({ mode: "recovering", snapshot: remote });
  const frozen = update.mock.lastCall?.[0];
  bridge.command?.({ kind: "play", seq: 1, movement: { x: 0, y: 0 } });
  bridge.command?.({
    kind: "input", seq: 2, movement: { x: 1, y: 0 }, action: "stone",
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(update.mock.lastCall?.[0]).toEqual(frozen);
  bridge.receive?.({ mode: "guest", snapshot: { ...remote, world: { ...remote.world, tick: 20 } } });
  expect(update.mock.lastCall?.[0].characters.map((character) => character.id)).toEqual(remote.world.players.map((player) => player.id));
});

it("updates the mode badge from native commands in local and remote rooms and restores the selected local skin", async () => {
  const update = vi.fn<(scene: CharacterSceneSnapshot) => void>();
  const mode = vi.fn();
  stop = startLocalGame({ clientWidth: 1280, clientHeight: 720 } as HTMLElement, { update, dispose: vi.fn() }, vi.fn(), mode);
  await vi.waitFor(() => expect(bridge.receive).toBeTypeOf("function"));
  bridge.skin?.("mint");
  expect(update.mock.lastCall?.[0].characters[0]?.skin).toBe("mint");
  bridge.command?.({ kind: "play", seq: 1, movement: { x: 0, y: 0 } });
  expect(mode).toHaveBeenLastCalledWith(true);
  bridge.receive?.({ mode: "guest", snapshot: snapshot() });
  bridge.command?.("stop");
  expect(mode).toHaveBeenLastCalledWith(false);
  bridge.command?.({ kind: "play", seq: 2, movement: { x: 0, y: 0 } });
  expect(mode).toHaveBeenLastCalledWith(true);
  bridge.command?.({ kind: "work", seq: 3, movement: { x: 0, y: 0 } });
  expect(mode).toHaveBeenLastCalledWith(false);
  bridge.receive?.({ mode: "local", snapshot: null });
  expect(update.mock.lastCall?.[0].characters[0]?.skin).toBe("mint");
  stop();
  stop = undefined;
  expect(bridge.stopSkin).toHaveBeenCalledOnce();
});
