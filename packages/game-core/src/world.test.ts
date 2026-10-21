import { describe, expect, test } from "vitest";
import { advance, createWorld } from "./index";
import type { PlayerInput, WorldSetup, WorldState } from "./index";

function setup(): WorldSetup {
  return {
    bounds: { width: 800, height: 600 },
    // 테스트 전용 값이며 제품의 속도·크기·tick 간격을 확정하지 않는다.
    rules: { tickMs: 50, moveSpeedUnitsPerSecond: 200, playerRadius: 16 },
    players: [
      { id: "host", position: { x: 100, y: 100 } },
      { id: "guest", position: { x: 400, y: 300 } },
    ],
  };
}

function input(x: -1 | 0 | 1, y: -1 | 0 | 1): PlayerInput {
  return { playerId: "host", movement: { x, y } };
}

describe("월드 초기화", () => {
  test("호출자의 초기 데이터와 수정 가능한 참조를 공유하지 않는다", () => {
    const initial = setup();
    const world = createWorld(initial);
    expect(world.tick).toBe(0);
    expect(world.projectiles).toEqual([]);
    expect(world.players).toHaveLength(2);
    expect(world.bounds).not.toBe(initial.bounds);
    expect(world.rules).not.toBe(initial.rules);
    expect(world.players[0]?.position).not.toBe(initial.players[0]?.position);
  });

  test.each([0, -1, NaN, Infinity])("유효하지 않은 월드 크기 %s를 거절한다", (width) => {
    const initial = setup();
    expect(() => createWorld({ ...initial, bounds: { ...initial.bounds, width } })).toThrow(RangeError);
  });

  test.each([0, -1, NaN, Infinity])("유효하지 않은 tick 간격 %s를 거절한다", (tickMs) => {
    const initial = setup();
    expect(() => createWorld({ ...initial, rules: { ...initial.rules, tickMs } })).toThrow(RangeError);
  });

  test.each([-1, NaN, Infinity])("유효하지 않은 이동 속도 %s를 거절한다", (moveSpeedUnitsPerSecond) => {
    const initial = setup();
    expect(() => createWorld({
      ...initial,
      rules: { ...initial.rules, moveSpeedUnitsPerSecond },
    })).toThrow(RangeError);
  });

  test.each([0, -1, NaN, Infinity, 301])("유효하지 않거나 월드보다 큰 반지름 %s를 거절한다", (playerRadius) => {
    const initial = setup();
    expect(() => createWorld({ ...initial, rules: { ...initial.rules, playerRadius } })).toThrow(RangeError);
  });

  test("한 tick 이동 거리가 무한대가 되는 설정을 거절한다", () => {
    const initial = setup();
    expect(() => createWorld({
      ...initial,
      rules: { ...initial.rules, moveSpeedUnitsPerSecond: Number.MAX_VALUE, tickMs: Number.MAX_VALUE },
    })).toThrow(RangeError);
  });

  test.each(["", "  ", "host"])("비어 있거나 중복된 캐릭터 ID %s를 거절한다", (id) => {
    const initial = setup();
    expect(() => createWorld({
      ...initial,
      players: [...initial.players, { id, position: { x: 200, y: 200 } }],
    })).toThrow(RangeError);
  });

  test.each([
    { x: 0, y: 100 }, { x: 800, y: 100 },
    { x: 100, y: 0 }, { x: 100, y: 600 },
    { x: NaN, y: 100 }, { x: 100, y: Infinity },
  ])("충돌 영역이 월드 밖에 있거나 비정상인 위치 %j를 거절한다", (position) => {
    expect(() => createWorld({ ...setup(), players: [{ id: "host", position }] })).toThrow(RangeError);
  });
});

describe("고정 tick 진행", () => {
  test("입력이 없어도 정확히 한 tick 진행하고 캐릭터를 유지한다", () => {
    const world = createWorld(setup());
    const next = advance(world, []);
    expect(next.tick).toBe(1);
    expect(next.players).toEqual(world.players);
    expect(world.tick).toBe(0);
  });

  test("캐릭터가 없는 월드도 진행할 수 있다", () => {
    const world = createWorld({ ...setup(), players: [] });
    expect(advance(world, [])).toEqual({ ...world, tick: 1 });
  });

  test.each([
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ] as const)("입력 (%s, %s)의 이동 거리는 방향과 무관하게 동일하다", (x, y) => {
    const next = advance(createWorld(setup()), [input(x, y)]);
    const position = next.players[0]?.position;
    expect(position).toBeDefined();
    if (position === undefined) throw new Error("캐릭터가 사라졌습니다.");
    expect(Math.hypot(position.x - 100, position.y - 100)).toBeCloseTo(10);
    expect(Math.sign(position.x - 100)).toBe(x);
    expect(Math.sign(position.y - 100)).toBe(y);
    expect(next.players[1]?.position).toEqual({ x: 400, y: 300 });
  });

  test("입력이 해제되면 정지하고 마지막 바라본 방향을 유지한다", () => {
    const moved = advance(createWorld(setup()), [input(-1, 0)]);
    const stopped = advance(moved, []);
    const neutral = advance(stopped, [input(0, 0)]);
    expect(stopped.players[0]?.position).toEqual({ x: 90, y: 100 });
    expect(neutral.players[0]).toEqual(stopped.players[0]);
    expect(neutral.players[0]?.facing).toEqual({ x: -1, y: 0 });
  });

  test.each([
    [-1, -1, 16, 16], [1, -1, 784, 16],
    [-1, 1, 16, 584], [1, 1, 784, 584],
  ] as const)("모서리를 향해 계속 이동해도 충돌 영역이 월드 안에 남는다 (%s, %s)", (x, y, endX, endY) => {
    let world = createWorld(setup());
    for (let tick = 0; tick < 200; tick++) world = advance(world, [input(x, y)]);
    expect(world.players[0]?.position).toEqual({ x: endX, y: endY });
    expect(world.players).toHaveLength(2);
  });

  test("고정 간격과 속도에 따라 1초 동안 같은 거리를 이동한다", () => {
    const initial = setup();
    function run(tickMs: number): WorldState {
      let world = createWorld({ ...initial, rules: { ...initial.rules, tickMs } });
      for (let timeMs = 0; timeMs < 1000; timeMs += tickMs) world = advance(world, [input(1, 0)]);
      return world;
    }
    expect(run(50).players[0]?.position).toEqual({ x: 300, y: 100 });
    expect(run(100).players[0]?.position).toEqual({ x: 300, y: 100 });
  });

  test("충돌 영역과 같은 크기의 월드에서도 유효 좌표를 유지한다", () => {
    const world = createWorld({
      ...setup(),
      bounds: { width: 32, height: 32 },
      players: [{ id: "host", position: { x: 16, y: 16 } }],
    });
    expect(advance(world, [input(1, 1)]).players[0]?.position).toEqual({ x: 16, y: 16 });
  });

  test("알 수 없는 캐릭터와 동일 tick의 중복 입력은 거절한다", () => {
    const world = createWorld(setup());
    expect(() => advance(world, [{ ...input(1, 0), playerId: "unknown" }])).toThrow(RangeError);
    expect(() => advance(world, [input(1, 0), input(-1, 0)])).toThrow(RangeError);
    expect(world.tick).toBe(0);
  });

  test.each([2, 0.5, NaN, Infinity])("유효하지 않은 이동 축 %s는 거절한다", (value) => {
    const invalid = { playerId: "host", movement: { x: value, y: 0 } } as PlayerInput;
    expect(() => advance(createWorld(setup()), [invalid])).toThrow(RangeError);
  });

  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("안전하게 진행할 수 없는 tick %s를 거절한다", (tick) => {
    expect(() => advance({ ...createWorld(setup()), tick }, [])).toThrow(RangeError);
  });

  test("다른 월드 실행과 입력 배열 순서에 무관하게 같은 입력 이력을 재현한다", () => {
    const initial = createWorld(setup());
    const original = structuredClone(initial);
    let first = initial;
    let replay = initial;
    for (let tick = 0; tick < 1000; tick++) {
      const inputs: readonly PlayerInput[] = [
        input(tick % 2 === 0 ? 1 : -1, 1),
        { playerId: "guest", movement: { x: 0, y: -1 } },
      ];
      first = advance(first, inputs);
      // 다른 월드를 진행해도 공유 상태나 암묵적인 시계에 의존하지 않는다.
      advance(createWorld(setup()), []);
      replay = advance(replay, [...inputs].reverse());
    }
    expect(first).toEqual(replay);
    expect(first.tick).toBe(1000);
    expect(initial).toEqual(original);
  });

  test("동결된 초기 상태와 입력을 수정하지 않고 다음 snapshot을 반환한다", () => {
    const world = createWorld(setup());
    for (const player of world.players) {
      Object.freeze(player.position);
      Object.freeze(player.facing);
      Object.freeze(player);
    }
    Object.freeze(world.rules);
    Object.freeze(world.bounds);
    Object.freeze(world.players);
    Object.freeze(world.projectiles);
    Object.freeze(world);
    const command = input(1, 1);
    Object.freeze(command.movement);
    Object.freeze(command);
    const commands = Object.freeze([command]);
    expect(advance(world, commands).tick).toBe(1);
    expect(world.players[0]?.position).toEqual({ x: 100, y: 100 });
  });
});
