import { describe, expect, test } from "vitest";
import { advance, createWorld } from "./index";
import type { CombatRules, PlayerAction, PlayerInput, WorldState } from "./index";

const combat: CombatRules = {
  meleeReach: 50, meleeCooldownMs: 600, stoneCooldownMs: 900,
  stoneSpeedUnitsPerSecond: 1000, stoneRadius: 5, stoneLifetimeMs: 1500,
  stunMs: 400, invulnerabilityMs: 500, knockbackMs: 200,
  knockbackSpeedUnitsPerSecond: 300, effectMs: 300,
};

function world(guestX = 160): WorldState {
  return createWorld({ bounds: { width: 800, height: 600 },
    rules: { tickMs: 50, playerRadius: 16, moveSpeedUnitsPerSecond: 200, combat },
    players: [{ id: "host", position: { x: 100, y: 100 } }, { id: "guest", position: { x: guestX, y: 100 } }] });
}
function action(kind: PlayerAction, playerId = "host"): PlayerInput {
  return { playerId, movement: { x: 0, y: 0 }, action: kind };
}
function steps(initial: WorldState, count: number): WorldState {
  let state = initial;
  for (let i = 0; i < count; i++) state = advance(state, []);
  return state;
}

describe("근접 공격과 피격", () => {
  test("전방 사거리 안 대상에게만 넉백·기절·면역을 적용하며 원본을 유지한다", () => {
    const initial = world();
    const original = structuredClone(initial);
    const next = advance(initial, [action("melee")]);
    expect(next.players[1]).toMatchObject({ stunnedUntilTick: 9, invulnerableUntilTick: 11,
      knockbackVelocity: { x: 300, y: 0 }, lastHitTick: 1 });
    expect(next.players[0]?.lastAction).toEqual({ kind: "melee", tick: 1 });
    expect(next.effects).toHaveLength(1);
    expect(initial).toEqual(original);
    expect(next.players).toHaveLength(2);
  });

  test.each([300, 40])("사거리 밖 또는 뒤쪽 대상 %s에는 명중하지 않는다", (x) => {
    const next = advance(world(x), [action("melee")]);
    expect(next.players[1]?.lastHitTick).toBeNull();
    expect(next.players[0]?.lastAction?.kind).toBe("melee");
  });

  test("공격 쿨다운 전에는 새 공격을 만들지 않고 만료 tick에는 허용한다", () => {
    const first = advance(world(), [action("melee")]);
    const repeated = advance(first, [action("melee")]);
    expect(repeated.players[0]?.lastAction?.tick).toBe(1);
    expect(advance(steps(first, 11), [action("melee")]).players[0]?.lastAction?.tick).toBe(13);
  });

  test("기절 중 이동과 공격은 차단하며 기절이 끝나면 조작이 복구된다", () => {
    const hit = advance(world(), [action("melee")]);
    const blocked = advance(hit, [{ ...action("stone", "guest"), movement: { x: -1, y: 0 } }]);
    expect(blocked.players[1]?.lastAction).toBeNull();
    expect(blocked.projectiles).toHaveLength(0);
    expect(blocked.players[1]?.position.x).toBe(175);
    const recovered = advance(steps(hit, 7), [{ playerId: "guest", movement: { x: 0, y: 1 } }]);
    expect(recovered.tick).toBe(9);
    expect(recovered.players[1]?.position.y).toBe(110);
  });

  test("면역 중 새 타격은 기절 타이머를 연장하지 않는다", () => {
    const first = advance(world(), [action("melee")]);
    const second = advance({ ...first, players: first.players.map((player) => player.id === "host"
      ? { ...player, meleeReadyAtTick: 0 } : player) }, [action("melee")]);
    expect(second.players[1]?.stunnedUntilTick).toBe(9);
    expect(second.players[1]?.lastHitTick).toBe(1);
  });

  test("경계에서 넉백 축을 정지하고 캐릭터를 삭제하지 않는다", () => {
    const initial = world(784);
    const state = { ...initial, players: initial.players.map((player) => player.id === "host"
      ? { ...player, position: { x: 730, y: 100 } } : player) };
    const result = steps(advance(state, [action("melee")]), 5);
    expect(result.players[1]?.position).toEqual({ x: 784, y: 100 });
    expect(result.players[1]?.knockbackVelocity.x).toBe(0);
    expect(result.players).toHaveLength(2);
  });

  test("동시 공격은 입력 순서와 무관하며 두 참가자 모두 공격한다", () => {
    const initial = world();
    const state = { ...initial, players: initial.players.map((player) => player.id === "guest"
      ? { ...player, facing: { x: -1, y: 0 } } : player) };
    const inputs = [action("melee"), action("melee", "guest")];
    const result = advance(state, inputs);
    expect(result).toEqual(advance(state, [...inputs].reverse()));
    expect(result.players.every((player) => player.lastHitTick === 1)).toBe(true);
  });
});

describe("돌 던지기", () => {
  test("발사자는 맞지 않고 쿨다운 동안 돌을 추가로 생성하지 않는다", () => {
    const first = advance(world(600), [action("stone")]);
    expect(first.projectiles).toHaveLength(1);
    expect(first.projectiles[0]?.position).toEqual({ x: 150, y: 100 });
    expect(first.players[0]?.lastHitTick).toBeNull();
    expect(advance(first, [action("stone")]).projectiles).toHaveLength(1);
  });

  test("빠른 돌의 이동 선분으로 충돌을 검출하고 한 대상에게만 적중한다", () => {
    const initial = world(160);
    const fast = { ...initial, rules: { ...initial.rules, combat: { ...combat, stoneSpeedUnitsPerSecond: 4000 } } };
    const result = advance(fast, [action("stone")]);
    expect(result.projectiles).toHaveLength(0);
    expect(result.players[1]?.lastHitTick).toBe(1);
    expect(result.players[1]?.stunnedUntilTick).toBe(9);
  });

  test("가장 가까운 대상만 타격한다", () => {
    const initial = world();
    const guest = initial.players[1];
    if (guest === undefined) throw new Error("대상 캐릭터 누락");
    const state = { ...initial,
      rules: { ...initial.rules, combat: { ...combat, stoneSpeedUnitsPerSecond: 4000 } },
      players: [...initial.players, { ...guest, id: "far", position: { x: 250, y: 100 } }] };
    const result = advance(state, [action("stone")]);
    expect(result.players.find((player) => player.id === "guest")?.lastHitTick).toBe(1);
    expect(result.players.find((player) => player.id === "far")?.lastHitTick).toBeNull();
  });

  test("경계 도달 시 돌을 제거하고 짧은 먼지 효과도 만료 후 정리한다", () => {
    const result = steps(advance(world(600), [action("stone")]), 20);
    expect(result.projectiles).toHaveLength(0);
    expect(result.effects).toHaveLength(0);
    expect(result.players).toHaveLength(2);
    const edge = world(600);
    const left = { ...edge, players: edge.players.map((player) => player.id === "host"
      ? { ...player, position: { x: 16, y: 100 }, facing: { x: -1, y: 0 } } : player) };
    const stopped = advance(left, [action("stone")]);
    expect(stopped.projectiles).toHaveLength(0);
    expect(stopped.effects[0]).toMatchObject({ kind: "dust", position: { x: 5, y: 100 } });
  });

  test("최대 비행 시간이 지나면 캐릭터와 무관하게 투사체만 정리한다", () => {
    const initial = world(600);
    const slow = { ...initial, rules: { ...initial.rules, combat: { ...combat, stoneSpeedUnitsPerSecond: 1 } } };
    const result = steps(advance(slow, [action("stone")]), 30);
    expect(result.projectiles).toHaveLength(0);
    expect(result.effects[0]?.kind).toBe("dust");
    expect(result.players).toHaveLength(2);
  });

  test("타격·투척을 섞은 입력 이력을 같은 월드에서 재현한다", () => {
    let a = world();
    let b = world();
    for (let tick = 0; tick < 1000; tick++) {
      const inputs: PlayerInput[] = [{ playerId: "host", movement: { x: tick % 2 === 0 ? 1 : -1, y: 0 },
        action: tick % 3 === 0 ? "melee" : "stone" }];
      a = advance(a, inputs);
      b = advance(b, inputs);
    }
    expect(a).toEqual(b);
    expect(a.projectiles.length).toBeLessThanOrEqual(2);
  });
});
