import type { PlayerInput, PlayerState, ProjectileState, Vector2, WorldEffect, WorldState } from "./types";

type MutablePlayer = { -readonly [Key in keyof PlayerState]: PlayerState[Key] };

function deadline(world: WorldState, durationMs: number): number {
  const tick = world.tick + Math.ceil(durationMs / world.rules.tickMs);
  if (!Number.isSafeInteger(tick)) throw new RangeError("Combat deadline exceeds safe ticks.");
  return tick;
}

// 반환값은 선분에서 원에 처음 닿는 비율이다. 빠른 돌이 한 tick에 대상을 통과해도 검출한다.
export function segmentCircleHit(from: Vector2, to: Vector2, center: Vector2, radius: number): number | undefined {
  const x = from.x - center.x;
  const y = from.y - center.y;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return;
  const b = 2 * (x * dx + y * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : undefined;
}

export function resolveCombat(world: WorldState, inputs: ReadonlyMap<string, PlayerInput>): WorldState {
  const combat = world.rules.combat;
  if (combat === undefined) return world;
  const rules = combat;
  const players: MutablePlayer[] = world.players.map((player) => ({ ...player }));
  const projectiles: ProjectileState[] = [];
  const pending = [...world.projectiles];
  const effects: WorldEffect[] = world.effects.filter((effect) => world.tick < effect.expiresAtTick);
  const seconds = world.rules.tickMs / 1000;

  function effect(id: string, kind: WorldEffect["kind"], position: Vector2): void {
    effects.push({ id, kind, position: { ...position }, startedAtTick: world.tick, expiresAtTick: deadline(world, rules.effectMs) });
  }

  function hit(target: MutablePlayer, direction: Vector2, id: string): void {
    if (world.tick < target.invulnerableUntilTick) return;
    target.knockbackVelocity = { x: direction.x * rules.knockbackSpeedUnitsPerSecond, y: direction.y * rules.knockbackSpeedUnitsPerSecond };
    target.knockbackUntilTick = deadline(world, rules.knockbackMs);
    target.stunnedUntilTick = deadline(world, rules.stunMs);
    target.invulnerableUntilTick = deadline(world, rules.invulnerabilityMs);
    target.lastHitTick = world.tick;
    effect(`${id}:hit:${target.id}`, "impact", target.position);
  }

  // 같은 tick의 입력은 피격 적용 전 상태로 수락한다. 입력 배열 순서로 선공이 정해지지 않는다.
  const actions = world.players.filter((player) => world.tick >= player.stunnedUntilTick)
    .map((player) => ({ player, action: inputs.get(player.id)?.action }))
    .sort((a, b) => a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0);
  for (const { player: original, action } of actions) {
    const player = players.find((entry) => entry.id === original.id);
    if (player === undefined) continue;
    const id = `${player.id}:${world.tick}`;
    if (action === "melee" && world.tick >= original.meleeReadyAtTick) {
      player.meleeReadyAtTick = deadline(world, rules.meleeCooldownMs);
      player.lastAction = { kind: "melee", tick: world.tick };
      for (const target of players) {
        if (target.id === player.id) continue;
        const dx = target.position.x - player.position.x;
        const dy = target.position.y - player.position.y;
        const length = Math.hypot(dx, dy);
        if (length > rules.meleeReach + world.rules.playerRadius * 2) continue;
        if (length > 0 && dx * player.facing.x + dy * player.facing.y <= 0) continue;
        hit(target, length === 0 ? player.facing : { x: dx / length, y: dy / length }, id);
      }
    } else if (action === "stone" && world.tick >= original.stoneReadyAtTick) {
      player.stoneReadyAtTick = deadline(world, rules.stoneCooldownMs);
      player.lastAction = { kind: "stone", tick: world.tick };
      pending.push({ id: `${id}:stone`, ownerId: player.id, position: { ...player.position },
        velocity: { x: player.facing.x * rules.stoneSpeedUnitsPerSecond, y: player.facing.y * rules.stoneSpeedUnitsPerSecond },
        expiresAtTick: deadline(world, rules.stoneLifetimeMs) });
    }
  }

  for (const stone of pending) {
    if (world.tick >= stone.expiresAtTick) { effect(stone.id, "dust", stone.position); continue; }
    const next = { x: stone.position.x + stone.velocity.x * seconds, y: stone.position.y + stone.velocity.y * seconds };
    const radius = rules.stoneRadius;
    const wallHit = next.x <= radius || next.x >= world.bounds.width - radius
      || next.y <= radius || next.y >= world.bounds.height - radius;
    // 이동 선분을 경계까지 자른 뒤 그 앞의 첫 캐릭터만 판정한다.
    let wall = 1;
    if (next.x < radius) wall = Math.min(wall, (radius - stone.position.x) / (next.x - stone.position.x));
    if (next.x > world.bounds.width - radius) wall = Math.min(wall, (world.bounds.width - radius - stone.position.x) / (next.x - stone.position.x));
    if (next.y < radius) wall = Math.min(wall, (radius - stone.position.y) / (next.y - stone.position.y));
    if (next.y > world.bounds.height - radius) wall = Math.min(wall, (world.bounds.height - radius - stone.position.y) / (next.y - stone.position.y));
    const end = { x: stone.position.x + (next.x - stone.position.x) * wall, y: stone.position.y + (next.y - stone.position.y) * wall };
    let nearest: { player: MutablePlayer; t: number } | undefined;
    for (const target of players) {
      if (target.id === stone.ownerId) continue;
      const t = segmentCircleHit(stone.position, end, target.position, world.rules.playerRadius + radius);
      if (t !== undefined && (nearest === undefined || t < nearest.t || (t === nearest.t && target.id < nearest.player.id))) nearest = { player: target, t };
    }
    if (nearest !== undefined) {
      const speed = Math.hypot(stone.velocity.x, stone.velocity.y);
      hit(nearest.player, { x: stone.velocity.x / speed, y: stone.velocity.y / speed }, stone.id);
    } else if (wallHit) {
      effect(stone.id, "dust", end);
    } else projectiles.push({ ...stone, position: end });
  }
  return { ...world, players, projectiles, effects };
}
