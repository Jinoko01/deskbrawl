import type { PlayerInput, WorldSetup, WorldState } from "./types";
import { resolveCombat } from "./combat";

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive.`);
  }
}

export function createWorld(setup: WorldSetup): WorldState {
  const { bounds, rules } = setup;
  requirePositive(bounds.width, "bounds.width");
  requirePositive(bounds.height, "bounds.height");
  requirePositive(rules.tickMs, "rules.tickMs");
  requirePositive(rules.playerRadius, "rules.playerRadius");
  if (!Number.isFinite(rules.moveSpeedUnitsPerSecond) || rules.moveSpeedUnitsPerSecond < 0) {
    throw new RangeError("rules.moveSpeedUnitsPerSecond must be finite and non-negative.");
  }
  const diameter = rules.playerRadius * 2;
  if (diameter > bounds.width || diameter > bounds.height) {
    throw new RangeError("The world must contain the full player collision area.");
  }
  if (!Number.isFinite(rules.moveSpeedUnitsPerSecond * (rules.tickMs / 1000))) {
    throw new RangeError("Movement per tick must be finite.");
  }
  if (rules.combat !== undefined) {
    for (const [name, value] of Object.entries(rules.combat)) requirePositive(value, `combat.${name}`);
    if (rules.combat.stoneRadius * 2 > Math.min(bounds.width, bounds.height)) {
      throw new RangeError("The world must contain a stone.");
    }
    for (const speed of [rules.combat.stoneSpeedUnitsPerSecond, rules.combat.knockbackSpeedUnitsPerSecond]) {
      if (!Number.isFinite(speed * (rules.tickMs / 1000))) throw new RangeError("Combat movement must be finite.");
    }
    if (rules.combat.knockbackMs > rules.combat.stunMs || rules.combat.invulnerabilityMs <= rules.combat.stunMs) {
      throw new RangeError("Knockback must end during stun, and immunity must outlast stun.");
    }
  }

  const ids = new Set<string>();
  const players = setup.players.map(({ id, position }) => {
    if (id.trim().length === 0 || ids.has(id)) {
      throw new RangeError("Player IDs must be non-empty and unique.");
    }
    ids.add(id);
    const { x, y } = position;
    const radius = rules.playerRadius;
    if (
      !Number.isFinite(x) || !Number.isFinite(y) ||
      x < radius || x > bounds.width - radius ||
      y < radius || y > bounds.height - radius
    ) {
      throw new RangeError("The player collision area must start inside the world.");
    }
    return { id, position: { x, y }, facing: { x: 1, y: 0 },
      knockbackVelocity: { x: 0, y: 0 }, knockbackUntilTick: 0, stunnedUntilTick: 0,
      invulnerableUntilTick: 0, meleeReadyAtTick: 0, stoneReadyAtTick: 0,
      lastAction: null, lastHitTick: null };
  });

  return {
    tick: 0,
    bounds: { ...bounds },
    rules: rules.combat === undefined ? { ...rules } : { ...rules, combat: { ...rules.combat } },
    players,
    projectiles: [],
    effects: [],
  };
}

// 한 번의 호출은 rules.tickMs에 해당하는 정확히 한 tick이다.
// 호출자는 해당 tick의 입력을 전달한다. 누락된 캐릭터 입력은 정지이며 이전 입력을 보존하지 않는다.
export function advance(world: WorldState, inputs: readonly PlayerInput[]): WorldState {
  if (!Number.isSafeInteger(world.tick) || world.tick < 0 || world.tick === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("The world tick cannot advance safely.");
  }
  const playerIds = new Set(world.players.map((player) => player.id));
  const byPlayer = new Map<string, PlayerInput>();
  for (const input of inputs) {
    if (!playerIds.has(input.playerId) || byPlayer.has(input.playerId)) {
      throw new RangeError("Each input must address a known player once per tick.");
    }
    const { x, y } = input.movement;
    if (![-1, 0, 1].includes(x) || ![-1, 0, 1].includes(y)) {
      throw new RangeError("Movement axes must be -1, 0 or 1.");
    }
    if (input.action !== undefined && (world.rules.combat === undefined || !["melee", "stone"].includes(input.action))) {
      throw new RangeError("The action is unavailable in this world.");
    }
    byPlayer.set(input.playerId, input);
  }

  const { playerRadius: radius, moveSpeedUnitsPerSecond, tickMs } = world.rules;
  const distance = moveSpeedUnitsPerSecond * (tickMs / 1000);
  const tick = world.tick + 1;
  const players = world.players.map((player) => {
    if (tick < player.knockbackUntilTick) {
      const nextX = player.position.x + player.knockbackVelocity.x * tickMs / 1000;
      const nextY = player.position.y + player.knockbackVelocity.y * tickMs / 1000;
      const x = Math.max(radius, Math.min(world.bounds.width - radius, nextX));
      const y = Math.max(radius, Math.min(world.bounds.height - radius, nextY));
      return { ...player, position: { x, y }, knockbackVelocity: {
        x: x === nextX ? player.knockbackVelocity.x : 0,
        y: y === nextY ? player.knockbackVelocity.y : 0,
      } };
    }
    const settled = player.knockbackVelocity.x !== 0 || player.knockbackVelocity.y !== 0
      ? { ...player, knockbackVelocity: { x: 0, y: 0 } } : player;
    if (tick < player.stunnedUntilTick) return settled;
    const movement = byPlayer.get(player.id)?.movement;
    if (movement === undefined || (movement.x === 0 && movement.y === 0)) return settled;
    const length = Math.hypot(movement.x, movement.y);
    const facing = { x: movement.x / length, y: movement.y / length };
    return {
      ...settled,
      facing,
      position: {
        x: Math.max(radius, Math.min(world.bounds.width - radius, player.position.x + facing.x * distance)),
        y: Math.max(radius, Math.min(world.bounds.height - radius, player.position.y + facing.y * distance)),
      },
    };
  });
  const next = { ...world, tick, players };
  return world.rules.combat === undefined ? next : resolveCombat(next, byPlayer);
}
