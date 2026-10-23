import { AnimatedSprite, Container, Graphics } from "pixi.js";
import { MAX_HP } from "@deskbrawl/game-core";
import type { Texture, Ticker } from "pixi.js";
import type { CharacterFrame, CharacterMotion } from "./characterScene";

type AnimationName = "idle" | "walk" | "melee" | "throw" | "hit";
export type CharacterAnimations = Record<AnimationName, Texture[]>;

// 에셋에 기록된 감상용 간격을 표현에만 사용한다. 공격 판정·기절 종료는 결정하지 않는다.
const FRAME_MS: Record<AnimationName, number> = {
  idle: 220,
  walk: 120,
  melee: 100,
  throw: 150,
  hit: 220,
};

function actionId(motion: CharacterMotion): string | undefined {
  return "actionId" in motion ? motion.actionId : undefined;
}

export function createCharacterView(animations: CharacterAnimations, stunFrames: Texture[]) {
  const body = new AnimatedSprite({ textures: animations.idle, autoUpdate: false });
  const stun = new AnimatedSprite({ textures: stunFrames, autoUpdate: false });
  const container = new Container();
  const healthBar = new Graphics();
  container.eventMode = "none";
  body.updateAnchor = true;
  body.roundPixels = true;
  stun.anchor.set(0.5);
  stun.roundPixels = true;
  stun.animationSpeed = 1000 / (60 * 120);
  stun.visible = false;
  container.addChild(body, stun, healthBar);
  let current: CharacterFrame | undefined;
  let completed = false;
  let horizontalDirection = 1;
  body.onComplete = () => {
    completed = true;
  };

  function syncMotion(reduced: boolean, visible: boolean): void {
    if (current === undefined) {
      return;
    }
    if (!visible) {
      body.stop();
      stun.stop();
    } else if (reduced) {
      let pose = body.loop ? 0 : Math.floor(body.totalFrames / 2);
      if (current.motion.kind === "stun") {
        pose = body.totalFrames - 1;
      }
      body.gotoAndStop(pose);
      stun.gotoAndStop(0);
    } else {
      if (current.motion.kind !== "stun" && !completed) {
        body.play();
      }
      if (stun.visible) {
        stun.play();
      }
    }
  }

  function apply(frame: CharacterFrame, reduced: boolean, visible: boolean): void {
    const changed = current?.motion.kind !== frame.motion.kind
      || actionId(current.motion) !== actionId(frame.motion);
    current = frame;
    container.label = `character:${frame.id}`;
    if (frame.facing.x !== 0) {
      horizontalDirection = frame.facing.x < 0 ? -1 : 1;
    }
    if (changed) {
      const name = frame.motion.kind === "stun" ? "hit" : frame.motion.kind;
      body.textures = animations[name];
      body.loop = name === "idle" || name === "walk";
      body.animationSpeed = 1000 / (60 * FRAME_MS[name]);
      completed = false;
      body.gotoAndStop(frame.motion.kind === "stun" ? body.totalFrames - 1 : 0);
      stun.visible = frame.motion.kind === "stun";
      stun.gotoAndStop(0);
    }
    syncMotion(reduced, visible);
  }

  function layout(x: number, y: number, size: number): void {
    container.position.set(Math.round(x), Math.round(y));
    body.scale.set(horizontalDirection * size / body.texture.orig.height, size / body.texture.orig.height);
    body.position.set(0, size * (body.anchor.y - 0.5));
    stun.scale.set(size * 0.55 / stun.texture.orig.height);
    stun.position.set(0, -size * 0.65);
    healthBar.clear();
    if (current?.hp !== undefined) {
      const width = size * 0.65;
      const height = Math.max(4, size * 0.06);
      const y = size * 0.42;
      healthBar.roundRect(-width / 2, y, width, height, height / 2).fill(0x171923);
      const remaining = (width - 2) * current.hp / MAX_HP;
      if (remaining > 0) {
        healthBar.rect(-width / 2 + 1, y + 1, remaining, height - 2).fill(0x8dde8c);
      }
    }
  }

  return {
    container,
    body,
    stun,
    apply,
    syncMotion,
    layout,
    update(ticker: Ticker): void {
      if (body.playing) {
        body.update(ticker);
      }
      if (stun.visible && stun.playing) {
        stun.update(ticker);
      }
    },
    get playing(): boolean {
      return body.playing || (stun.visible && stun.playing);
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
