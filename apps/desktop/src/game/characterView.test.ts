import { Rectangle, Texture, Ticker } from "pixi.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CharacterFrame, CharacterMotion } from "./characterScene";
import { initialCharacterScene } from "./characterScene";
import { createCharacterView } from "./characterView";
import type { CharacterAnimations } from "./characterView";

describe("캐릭터 표현", () => {
  let animations: CharacterAnimations;
  let stunFrames: Texture[];
  let view: ReturnType<typeof createCharacterView>;
  const textures: Texture[] = [];

  function frames(count: number): Texture[] {
    return Array.from({ length: count }, () => {
      const texture = new Texture({ source: Texture.EMPTY.source,
        orig: new Rectangle(0, 0, 100, 100), defaultAnchor: { x: 0.5, y: 0.9 } });
      textures.push(texture);
      return texture;
    });
  }

  function state(motion: CharacterMotion): CharacterFrame {
    return { id: "host", skin: "mochi", position: { x: 100, y: 100 },
      facing: { x: 1, y: 0 }, motion };
  }

  function step(elapsedMs: number): void {
    const ticker = new Ticker();
    ticker.minFPS = 0;
    ticker.update(0);
    ticker.update(elapsedMs);
    view.update(ticker);
    ticker.destroy();
  }

  beforeEach(() => {
    animations = { idle: frames(4), walk: frames(4), melee: frames(4), throw: frames(2), hit: frames(2) };
    stunFrames = frames(4);
    view = createCharacterView(animations, stunFrames);
  });

  afterEach(() => {
    view.destroy();
    for (const texture of textures) texture.destroy();
    textures.length = 0;
  });

  test.each(["idle", "walk"] as const)("%s 모션은 반복하며 같은 상태 전달로 초기화되지 않는다", (kind) => {
    const frame = state({ kind });
    view.apply(frame, false, true);
    step(250);
    expect(view.body.loop).toBe(true);
    expect(view.body.currentFrame).toBeGreaterThan(0);
    const currentFrame = view.body.currentFrame;
    view.apply({ ...frame }, false, true);
    expect(view.body.currentFrame).toBe(currentFrame);
    expect(view.playing).toBe(true);
  });

  test.each(["melee", "throw", "hit"] as const)("%s는 actionId마다 한 번만 재생한다", (kind) => {
    const frame = state({ kind, actionId: "first" });
    view.apply(frame, false, true);
    step(1000);
    expect(view.body.playing).toBe(false);
    expect(view.body.currentFrame).toBe(view.body.totalFrames - 1);
    view.apply({ ...frame }, false, true);
    expect(view.body.playing).toBe(false);
    view.syncMotion(true, true);
    view.syncMotion(false, true);
    expect(view.body.playing).toBe(false);
    view.apply(state({ kind, actionId: "second" }), false, true);
    expect(view.body.currentFrame).toBe(0);
    expect(view.body.playing).toBe(true);
  });

  test("기절은 피격 마지막 자세와 별 이펙트를 표시하고 상태 해제 시 사라진다", () => {
    const frame = state({ kind: "stun" });
    view.apply(frame, false, true);
    expect(view.body.textures).toBe(animations.hit);
    expect(view.body.currentFrame).toBe(1);
    expect(view.body.playing).toBe(false);
    expect(view.stun.visible).toBe(true);
    step(250);
    expect(view.stun.currentFrame).toBeGreaterThan(0);
    view.apply(state({ kind: "idle" }), false, true);
    expect(view.stun.visible).toBe(false);
    expect(view.body.textures).toBe(animations.idle);
    // 표현 갱신은 입력으로 받은 상태를 변경하지 않는다.
    expect(frame.motion.kind).toBe("stun");
  });

  test("좌우 반전과 발 anchor를 적용하고 상하 방향에서 직전 좌우 방향을 유지한다", () => {
    view.apply({ ...state({ kind: "walk" }), facing: { x: -1, y: 0 } }, false, true);
    view.layout(120.4, 140.6, 96);
    expect(view.body.scale.x).toBeCloseTo(-0.96);
    expect(view.body.scale.y).toBeCloseTo(0.96);
    expect(view.body.anchor.y).toBe(0.9);
    expect(view.body.y).toBeCloseTo(38.4);
    expect(view.container.position).toMatchObject({ x: 120, y: 141 });
    view.apply({ ...state({ kind: "walk" }), facing: { x: 0, y: -1 } }, false, true);
    view.layout(120, 140, 96);
    expect(view.body.scale.x).toBeLessThan(0);
  });

  test("효과 감소에서도 새 위치와 기절 상태를 갱신하고 반복 애니메이션만 멈춘다", () => {
    view.apply(state({ kind: "stun" }), true, true);
    view.layout(300, 200, 96);
    expect(view.playing).toBe(false);
    expect(view.stun.visible).toBe(true);
    expect(view.body.currentFrame).toBe(1);
    expect(view.container.position).toMatchObject({ x: 300, y: 200 });
    view.syncMotion(false, true);
    expect(view.stun.playing).toBe(true);
    view.syncMotion(false, false);
    expect(view.playing).toBe(false);
  });

  test("장면을 제거해도 공유받은 atlas 텍스처를 파괴하지 않는다", () => {
    const second = createCharacterView(animations, stunFrames);
    second.apply(state({ kind: "idle" }), false, true);
    second.destroy();
    expect(second.container.destroyed).toBe(true);
    expect(animations.idle[0]?.destroyed).toBe(false);
    view.apply(state({ kind: "walk" }), false, true);
    step(250);
    expect(view.body.currentFrame).toBeGreaterThan(0);
  });
});

test.each([[320, 200], [180, 120], [1, 1]])("초기 장면 %s×%s에서 구분되는 두 캐릭터를 표시한다", (width, height) => {
  const scene = initialCharacterScene(width, height);
  expect(scene.characters.map((frame) => frame.skin)).toEqual(["mochi", "mint"]);
  expect(scene.characters[0]?.position.x).toBeLessThan(scene.characters[1]?.position.x ?? 0);
  for (const frame of scene.characters) {
    expect(frame.position.x).toBeGreaterThanOrEqual(0);
    expect(frame.position.x).toBeLessThanOrEqual(width);
    expect(frame.position.y).toBe(height / 2);
  }
});
