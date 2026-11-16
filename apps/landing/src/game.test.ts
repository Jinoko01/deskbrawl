import { expect, test } from "vitest";
import { createGame, FRIEND, HOST } from "./game";

function run(game: ReturnType<typeof createGame>, ms: number): void {
  for (let now = 0; now <= ms; now += 50) {
    game.advanceTime(now);
  }
}

function player(game: ReturnType<typeof createGame>, id: string) {
  const found = game.world.players.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`${id} 없음`);
  }
  return found;
}

test("초대한 친구는 호스트에서 먼 쪽 가장자리로 들어와 호스트 쪽으로 걸어온다", () => {
  const game = createGame(1000, 600, () => 0.99);
  game.place(HOST, { x: 300, y: 300 });
  game.invite();
  const start = player(game, FRIEND).position.x;
  run(game, 1000);
  expect(start).toBe(1000 - 24);
  expect(player(game, FRIEND).position.x).toBeLessThan(start);
});

test("PLAY에서 톡 한 번은 가까운 친구의 HP를 3 깎는다", () => {
  const game = createGame(1000, 600, () => 0.99);
  game.invite();
  game.place(FRIEND, { x: 560, y: 300 });
  game.setPlaying(true);
  game.control({ x: 0, y: 0 }, "melee");
  run(game, 50);
  expect(player(game, FRIEND).hp).toBe(47);
});

test("WORK에서는 조작 입력을 받지 않는다", () => {
  const game = createGame(1000, 600);
  game.control({ x: 1, y: 0 });
  run(game, 500);
  expect(player(game, HOST).position.x).toBe(500);
});

test("돌려보내면 친구와 친구가 던진 돌이 함께 사라진다", () => {
  const game = createGame(1000, 600, () => 0.5);
  game.invite();
  game.setPlaying(true);
  run(game, 4000);
  game.dismiss();
  expect(game.hasFriend).toBe(false);
  expect(game.world.projectiles.every((stone) => stone.ownerId !== FRIEND)).toBe(true);
});
