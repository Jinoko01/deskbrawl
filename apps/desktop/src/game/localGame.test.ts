import { expect, test, vi } from "vitest";
import { createLocalGame } from "./localGame";
import type { LocalCommand } from "../native/localGame";
import type { CharacterSceneSnapshot } from "./characterScene";

function command(kind: LocalCommand["kind"], seq: number, x: -1 | 0 | 1, action?: LocalCommand["action"]): LocalCommand {
  return {
    kind,
    seq,
    movement: { x, y: 0 },
    ...(action ? { action } : {}),
  };
}

test("PLAY의 최신 입력만 고정 tick에 적용하고 WORK에서 이동을 멈춘다", () => {
  const scenes: number[] = [];
  const game = createLocalGame(800, 600, (scene) => scenes.push(scene.characters[0]?.position.x ?? 0));
  const start = game.world.players[0]?.position.x;
  game.advanceTime(0);
  game.command(command("play", 1, 0));
  game.command(command("input", 3, 1));
  game.command(command("input", 2, -1));
  game.advanceTime(50);
  expect(game.world.players[0]?.position.x).toBe((start ?? 0) + 12);
  game.command(command("work", 4, 0));
  game.advanceTime(100);
  expect(game.world.players[0]?.position.x).toBe((start ?? 0) + 12);
  expect(game.playing).toBe(false);
  expect(scenes.length).toBeGreaterThan(1);
});

test("긴 시계 공백과 일시 정지는 눌린 키와 예약 공격을 버린다", () => {
  let gaps = 0;
  const game = createLocalGame(800, 600, vi.fn(), () => {
    gaps++;
  });
  game.advanceTime(0);
  game.command(command("play", 1, 0));
  game.command(command("input", 2, 1, "stone"));
  game.advanceTime(300);
  expect(game.playing).toBe(false);
  expect(gaps).toBe(1);
  expect(game.world.players[0]?.lastAction).toBeNull();
  game.command(command("play", 3, 0));
  game.advanceTime(350);
  expect(game.world.players[0]?.lastAction).toBeNull();
  game.command(command("input", 4, 0, "melee"));
  game.pause();
  game.advanceTime(1000);
  expect(game.world.players[0]?.lastAction).toBeNull();
});

test("돌과 피격 상태를 장면에 전달하고 같은 상태의 중복 렌더를 피한다", () => {
  const scenes: { stones: number; guestHit: boolean; hp: number | undefined }[] = [];
  const game = createLocalGame(800, 600, (scene) => scenes.push({
    stones: scene.projectiles?.length ?? 0,
    guestHit: scene.characters[1]?.motion.kind === "hit" || scene.characters[1]?.motion.kind === "stun",
    hp: scene.characters[1]?.hp,
  }));
  game.advanceTime(0);
  game.command(command("play", 1, 0));
  game.command(command("input", 2, 0, "stone"));
  for (let time = 50; time <= 250; time += 50) {
    game.advanceTime(time);
  }
  expect(scenes.some((scene) => scene.stones > 0)).toBe(true);
  expect(scenes.some((scene) => scene.guestHit)).toBe(true);
  expect(scenes[0]?.hp).toBe(50);
  expect(scenes.at(-1)?.hp).toBe(49);
  const count = scenes.length;
  game.advanceTime(250);
  expect(scenes).toHaveLength(count);
});

test("로컬 입력으로 HP를 소진하면 기절을 표시하고 3초 후 회복 장면을 전달한다", () => {
  const render = vi.fn<(scene: CharacterSceneSnapshot) => void>();
  const game = createLocalGame(320, 200, render);
  game.advanceTime(0);
  game.command(command("play", 1, 0));
  let sequence = 1;
  let time = 0;
  while (game.world.players[1]?.hp !== 0 && time < 25000) {
    const host = game.world.players[0];
    const guest = game.world.players[1];
    if (host === undefined || guest === undefined) {
      throw new Error("Missing local player");
    }
    game.command(command("input", ++sequence, guest.position.x - host.position.x > 100 ? 1 : 0, "melee"));
    game.advanceTime(time += 50);
  }
  expect(game.world.players[1]?.hp).toBe(0);
  expect(render.mock.lastCall?.[0].characters[1]).toMatchObject({ hp: 0, motion: { kind: "stun" } });
  game.command(command("work", sequence + 1, 0));
  for (let tick = 0; tick < 59; tick++) {
    game.advanceTime(time += 50);
  }
  expect(game.world.players[1]?.hp).toBe(0);
  game.advanceTime(time + 50);
  expect(game.world.players[1]?.hp).toBe(50);
  expect(render.mock.lastCall?.[0].characters[1]).toMatchObject({ hp: 50, motion: { kind: "idle" } });
});
