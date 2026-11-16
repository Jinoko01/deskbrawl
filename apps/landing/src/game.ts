import { advance, createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import type {
  MovementAxis, PlayerAction, PlayerInput, PlayerState, Vector2, WorldState,
} from "@deskbrawl/game-core";

export const HOST = "host";
export const FRIEND = "friend";

// 데스크톱 로컬 게임(apps/desktop/src/game/localGame.ts)과 같은 검증용 수치다.
const RULES = {
  tickMs: 50,
  moveSpeedUnitsPerSecond: 240,
  playerRadius: 24,
  combat: DEFAULT_COMBAT,
};
const MAX_CATCH_UP_TICKS = 5;
const POKE_DISTANCE = RULES.combat.meleeReach + RULES.playerRadius * 2 - 12;

type Movement = PlayerInput["movement"];
type BotPlan = "approach" | "poke" | "throw" | "back" | "rest";

function axis(delta: number, deadZone: number): MovementAxis {
  if (Math.abs(delta) <= deadZone) {
    return 0;
  }
  return delta > 0 ? 1 : -1;
}

function ticks(ms: number): number {
  return Math.ceil(ms / RULES.tickMs);
}

export function createGame(width: number, height: number, random: () => number = Math.random) {
  const bounds = { width: Math.max(320, width), height: Math.max(200, height) };
  let world = createWorld({
    bounds,
    rules: RULES,
    players: [{ id: HOST, position: { x: bounds.width / 2, y: bounds.height / 2 } }],
  });
  let playing = false;
  let movement: Movement = { x: 0, y: 0 };
  let pending: PlayerAction | undefined;
  let previous: readonly PlayerState[] = world.players;
  let previousTime: number | undefined;
  let accumulated = 0;
  let plan: BotPlan = "rest";
  let planUntil = 0;

  function find(id: string): PlayerState | undefined {
    return world.players.find((player) => player.id === id);
  }

  function clamp(position: Vector2): Vector2 {
    const radius = RULES.playerRadius;
    return {
      x: Math.max(radius, Math.min(world.bounds.width - radius, position.x)),
      y: Math.max(radius, Math.min(world.bounds.height - radius, position.y)),
    };
  }

  // 체험용 친구 봇. 판정은 game-core가 하고, 여기서는 입력 의도만 고른다.
  function friendInput(): PlayerInput | undefined {
    const friend = find(FRIEND);
    const host = find(HOST);
    if (friend === undefined || host === undefined) {
      return undefined;
    }
    const dx = host.position.x - friend.position.x;
    const dy = host.position.y - friend.position.y;
    const distance = Math.hypot(dx, dy);
    if (world.tick >= planUntil) {
      const roll = random();
      // 상대가 일하는 중이거나 기절했으면 얌전히 군다.
      const calm = !playing || host.hp === 0;
      if (distance > 360) {
        plan = "approach";
      } else if (calm) {
        plan = roll < 0.1 && host.hp > 0 ? "poke" : "rest";
      } else if (roll < 0.4) {
        plan = "poke";
      } else if (roll < 0.65) {
        plan = "throw";
      } else {
        plan = roll < 0.85 ? "back" : "rest";
      }
      planUntil = world.tick + ticks(400 + random() * 600);
    }
    const move = (x: MovementAxis, y: MovementAxis): PlayerInput => ({ playerId: FRIEND, movement: { x, y } });
    switch (plan) {
      case "approach":
        return distance > 150 ? move(axis(dx, 16), axis(dy, 16)) : undefined;
      case "poke":
        if (distance > POKE_DISTANCE) {
          return move(axis(dx, 16), axis(dy, 16));
        }
        plan = "back";
        planUntil = world.tick + ticks(400);
        return { ...move(axis(dx, 16), axis(dy, 16)), action: "melee" };
      case "throw":
        if (Math.abs(dy) > 20) {
          return move(0, axis(dy, 20));
        }
        plan = "rest";
        planUntil = world.tick + ticks(500);
        return { ...move(axis(dx, 0), 0), action: "stone" };
      case "back":
        return move(axis(-dx, 16), axis(-dy, 16));
      default:
        return undefined;
    }
  }

  return {
    get world(): WorldState {
      return world;
    },
    // 직전 tick의 캐릭터 상태. 렌더러가 두 tick 사이를 보간할 때 쓴다.
    get previous(): readonly PlayerState[] {
      return previous;
    },
    get playing(): boolean {
      return playing;
    },
    get hasFriend(): boolean {
      return find(FRIEND) !== undefined;
    },
    setPlaying(next: boolean): void {
      playing = next;
      movement = { x: 0, y: 0 };
      pending = undefined;
    },
    control(next: Movement, action?: PlayerAction): void {
      if (!playing) {
        return;
      }
      movement = next;
      pending = action ?? pending;
    },
    // WORK에서 캐릭터를 끌어 옮긴다. PLAY 중에는 받지 않는다.
    place(id: string, position: Vector2): void {
      if (playing || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        return;
      }
      world = {
        ...world,
        players: world.players.map((player) => player.id === id ? { ...player, position: clamp(position) } : player),
      };
      previous = world.players;
    },
    resize(nextWidth: number, nextHeight: number): void {
      world = { ...world, bounds: { width: Math.max(320, nextWidth), height: Math.max(200, nextHeight) } };
      world = { ...world, players: world.players.map((player) => ({ ...player, position: clamp(player.position) })) };
      previous = world.players;
    },
    invite(): void {
      const host = find(HOST);
      if (host === undefined || find(FRIEND) !== undefined) {
        return;
      }
      const side = host.position.x < world.bounds.width / 2 ? 1 : -1;
      const position = clamp({ x: side > 0 ? world.bounds.width : 0, y: host.position.y });
      const seat = createWorld({ bounds: world.bounds, rules: RULES, players: [{ id: FRIEND, position }] }).players[0];
      if (seat === undefined) {
        return;
      }
      world = { ...world, players: [...world.players, { ...seat, facing: { x: -side, y: 0 } }] };
      plan = "approach";
      planUntil = world.tick + ticks(1000);
    },
    dismiss(): void {
      world = {
        ...world,
        players: world.players.filter((player) => player.id !== FRIEND),
        projectiles: world.projectiles.filter((stone) => stone.ownerId !== FRIEND),
      };
    },
    // 고정 tick으로 진행하고 마지막 두 tick 사이의 보간 비율을 돌려준다.
    advanceTime(nowMs: number): number {
      const elapsed = previousTime === undefined ? 0 : Math.max(0, nowMs - previousTime);
      previousTime = nowMs;
      accumulated += Math.min(elapsed, RULES.tickMs * MAX_CATCH_UP_TICKS);
      while (accumulated >= RULES.tickMs) {
        const inputs: PlayerInput[] = [];
        if (playing) {
          inputs.push({ playerId: HOST, movement, ...(pending === undefined ? {} : { action: pending }) });
        }
        const bot = friendInput();
        if (bot !== undefined) {
          inputs.push(bot);
        }
        previous = world.players;
        world = advance(world, inputs);
        pending = undefined;
        accumulated -= RULES.tickMs;
      }
      return accumulated / RULES.tickMs;
    },
    resetClock(): void {
      previousTime = undefined;
      accumulated = 0;
    },
  };
}
