import { advance, createWorld } from "@deskbrawl/game-core";
import type { CombatRules, PlayerAction, PlayerInput, WorldState } from "@deskbrawl/game-core";
import type { LocalCommand } from "../native/localGame";
import type { CharacterMotion, CharacterSceneSnapshot } from "./characterScene";
import { initialCharacterScene } from "./characterScene";

// 로컬 검증용 조정값이다. 제품 확정값은 추후 실기기 검증으로 결정한다.
export const LOCAL_COMBAT: CombatRules = {
  meleeReach: 72, meleeCooldownMs: 600, stoneCooldownMs: 900,
  stoneSpeedUnitsPerSecond: 650, stoneRadius: 8, stoneLifetimeMs: 1500,
  stunMs: 400, invulnerabilityMs: 500, knockbackMs: 200,
  knockbackSpeedUnitsPerSecond: 450, effectMs: 300,
};

function motion(world: WorldState, player: WorldState["players"][number], moving: boolean): CharacterMotion {
  if (world.tick < player.knockbackUntilTick) return { kind: "hit", actionId: `${player.id}:hit:${player.lastHitTick}` };
  if (world.tick < player.stunnedUntilTick) return { kind: "stun" };
  const last = player.lastAction;
  if (last !== null && (world.tick - last.tick) * world.rules.tickMs < (last.kind === "melee" ? 400 : 300)) {
    return { kind: last.kind === "melee" ? "melee" : "throw", actionId: `${player.id}:${last.tick}` };
  }
  return { kind: moving ? "walk" : "idle" };
}

function sameScene(a: CharacterSceneSnapshot | undefined, b: CharacterSceneSnapshot): boolean {
  if (a === undefined || a.characters.length !== b.characters.length || a.projectiles?.length !== b.projectiles?.length || a.effects?.length !== b.effects?.length) return false;
  return a.characters.every((frame, index) => {
    const other = b.characters[index];
    return other !== undefined && frame.id === other.id && frame.position.x === other.position.x && frame.position.y === other.position.y
      && frame.facing.x === other.facing.x && frame.facing.y === other.facing.y && frame.motion.kind === other.motion.kind
      && ("actionId" in frame.motion ? frame.motion.actionId : undefined) === ("actionId" in other.motion ? other.motion.actionId : undefined);
  }) && (a.projectiles ?? []).every((stone, index) => {
    const other = b.projectiles?.[index];
    return other !== undefined && stone.id === other.id && stone.position.x === other.position.x && stone.position.y === other.position.y;
  }) && (a.effects ?? []).every((effect, index) => effect.id === b.effects?.[index]?.id);
}

export function createLocalGame(width: number, height: number, render: (snapshot: CharacterSceneSnapshot) => void,
  onClockGap: () => void = () => {}) {
  // 초기 WebView가 지나치게 작아도 유효한 논리 영역을 유지한다.
  const initial = initialCharacterScene(Math.max(320, width), Math.max(200, height));
  let world = createWorld({ bounds: initial.bounds,
    rules: { tickMs: 50, moveSpeedUnitsPerSecond: 240, playerRadius: 24, combat: LOCAL_COMBAT },
    players: initial.characters });
  world = { ...world, players: world.players.map((player) => player.id === "guest" ? { ...player, facing: { x: -1, y: 0 } } : player) };
  let playing = false;
  let lastSequence = 0;
  let movement: PlayerInput["movement"] = { x: 0, y: 0 };
  let pending: PlayerAction | undefined;
  let previousTime: number | undefined;
  let accumulated = 0;
  let previousScene: CharacterSceneSnapshot | undefined;

  function stop(): void { playing = false; movement = { x: 0, y: 0 }; pending = undefined; }

  function publish(before: WorldState): void {
    const snapshot: CharacterSceneSnapshot = { bounds: world.bounds,
      characters: world.players.map((player, index) => ({ id: player.id, position: player.position, facing: player.facing,
        skin: player.id === "host" ? "mochi" : "mint",
        motion: motion(world, player, player.position.x !== before.players[index]?.position.x || player.position.y !== before.players[index]?.position.y) })),
      projectiles: world.projectiles, effects: world.effects };
    if (!sameScene(previousScene, snapshot)) { previousScene = snapshot; render(snapshot); }
  }
  publish(world);
  return {
    get world(): WorldState { return world; },
    get playing(): boolean { return playing; },
    command(command: LocalCommand | "stop"): void {
      if (command === "stop" || command.kind === "work") { stop(); return; }
      if (command.kind === "play") { stop(); playing = true; lastSequence = command.seq; return; }
      if (!playing || command.seq <= lastSequence) return;
      lastSequence = command.seq;
      movement = command.movement;
      // 한 tick에 보관하는 공격은 하나이며, 프레임 지연 뒤 오래된 공격을 몰아 실행하지 않는다.
      pending = command.action ?? pending;
    },
    advanceTime(nowMs: number): void {
      if (!Number.isFinite(nowMs)) throw new Error("Invalid local clock");
      const elapsed = previousTime === undefined ? 0 : Math.max(0, nowMs - previousTime);
      previousTime = nowMs;
      if (elapsed > world.rules.tickMs * 5) { stop(); accumulated = 0; onClockGap(); }
      accumulated += Math.min(elapsed, world.rules.tickMs * 5);
      let steps = 0;
      while (accumulated >= world.rules.tickMs && steps++ < 5) {
        const before = world;
        const input: PlayerInput = { playerId: "host", movement,
          ...(pending === undefined ? {} : { action: pending }) };
        world = advance(world, playing ? [input] : []);
        pending = undefined;
        accumulated -= world.rules.tickMs;
        publish(before);
      }
    },
    pause(): void { stop(); previousTime = undefined; accumulated = 0; },
  };
}
