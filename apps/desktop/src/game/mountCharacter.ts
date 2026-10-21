import {
  AnimatedSprite,
  Application,
  ImageSource,
  Spritesheet,
  Texture,
} from "pixi.js";
import type { SpritesheetData } from "pixi.js";
// Tauri의 script-src 'self'를 유지하면서 eval 없는 shader 경로를 사용한다.
import "pixi.js/unsafe-eval";
import mochiAtlas from "../../../../packages/game-assets/characters/mochi-v2.json";
import mochiImage from "../../../../packages/game-assets/characters/mochi-v2.png";
import mintAtlas from "../../../../packages/game-assets/characters/mint-v2.json";
import mintImage from "../../../../packages/game-assets/characters/mint-v2.png";
import effectsAtlas from "../../../../packages/game-assets/effects/effects-v2.json";
import effectsImage from "../../../../packages/game-assets/effects/effects-v2.png";
import propsAtlas from "../../../../packages/game-assets/props/props-v2.json";
import propsImage from "../../../../packages/game-assets/props/props-v2.png";
import { reportRendererFailure, watchReducedEffects } from "../native/overlay";
import { CHARACTER_SIZE_PX, initialCharacterScene } from "./characterScene";
import type { CharacterSceneSnapshot, CharacterSkin } from "./characterScene";
import { createCharacterView } from "./characterView";
import type { CharacterAnimations } from "./characterView";

export interface MountedCharacterScene {
  update: (snapshot: CharacterSceneSnapshot) => void;
  dispose(): void;
}

export function mountCharacter(
  host: HTMLElement,
  onStatus: (status: "loading" | "ready" | "error") => void,
  target: "overlay" | "preview" = "overlay",
): MountedCharacterScene {
  const app = new Application();
  let disposed = false;
  let failed = false;
  let initializing = true;
  let initialized = false;
  let ready = false;
  const sheets: Spritesheet[] = [];
  const animations = new Map<CharacterSkin, CharacterAnimations>();
  const views = new Map<string, { skin: CharacterSkin; view: ReturnType<typeof createCharacterView> }>();
  const stones = new Map<string, AnimatedSprite>();
  const effects = new Map<string, AnimatedSprite>();
  let stunFrames: Texture[] = [];
  let stoneFrames: Texture[] = [];
  let impactFrames: Texture[] = [];
  let dustFrames: Texture[] = [];
  let supplied: CharacterSceneSnapshot | undefined;
  let current: CharacterSceneSnapshot | undefined;
  let observer: ResizeObserver | undefined;
  let reducedEffects = true;
  let stopPreferences: (() => void) | undefined;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const decorative = new WeakSet<AnimatedSprite>();

  function release() {
    ready = false;
    observer?.disconnect();
    window.removeEventListener("resize", draw);
    reducedMotion.removeEventListener("change", syncMotion);
    document.removeEventListener("visibilitychange", syncMotion);
    stopPreferences?.();
    if (initialized) {
      initialized = false;
      app.canvas.removeEventListener("webglcontextlost", onContextLost);
      app.destroy(true, { children: true });
    }
    views.clear();
    stones.clear();
    effects.clear();
    animations.clear();
    for (const sheet of sheets) {
      sheet.destroy(true);
    }
    sheets.length = 0;
    stunFrames = [];
    stoneFrames = [];
    impactFrames = [];
    dustFrames = [];
    supplied = undefined;
    current = undefined;
  }

  function fail(error: unknown) {
    if (failed) {
      return;
    }
    failed = true;
    if (!initializing) {
      release();
    }
    if (!disposed) {
      console.error("오버레이 캐릭터 렌더링 실패", error);
      onStatus("error");
      if (target === "overlay") {
        void reportRendererFailure().catch((failure: unknown) => {
          console.error("오버레이 렌더 오류 보고 실패", failure);
        });
      }
    }
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("WebGL context가 손실되었습니다."));
  }

  function syncMotion() {
    if (!ready || disposed || failed) {
      return;
    }
    try {
      for (const { view } of views.values()) {
        view.syncMotion(reduced(), !document.hidden);
      }
      for (const sprite of [...stones.values(), ...effects.values()]) {
        syncSprite(sprite);
      }
      syncTicker();
      paint();
      app.render();
    } catch (error) {
      fail(error);
    }
  }

  function reduced(): boolean {
    return reducedEffects || reducedMotion.matches;
  }

  function syncSprite(sprite: AnimatedSprite): void {
    // 효과 감소에서는 판정과 무관한 먼지만 숨긴다. 돌·피격·기절 표시는 게임 상태라서 유지한다.
    sprite.visible = !(decorative.has(sprite) && reduced());
    if (document.hidden) {
      sprite.stop();
    } else if (reduced()) {
      sprite.gotoAndStop(0);
    } else if (sprite.loop || sprite.currentFrame < sprite.totalFrames - 1) {
      sprite.play();
    }
  }

  function makeSprite(frames: Texture[], label: string, loop: boolean, frameMs: number): AnimatedSprite {
    if (frames.length === 0) {
      throw new Error(`${label} 프레임이 없습니다.`);
    }
    const sprite = new AnimatedSprite({ textures: frames, autoUpdate: false });
    sprite.updateAnchor = true;
    sprite.roundPixels = true;
    sprite.eventMode = "none";
    sprite.label = label;
    sprite.loop = loop;
    sprite.animationSpeed = 1000 / (60 * frameMs);
    syncSprite(sprite);
    app.stage.addChild(sprite);
    return sprite;
  }

  function removeMissing(map: Map<string, AnimatedSprite>, ids: Set<string>): void {
    for (const [id, sprite] of map) {
      if (!ids.has(id)) {
        sprite.destroy();
        map.delete(id);
      }
    }
  }

  function syncTicker() {
    if (!document.hidden && !reduced()) {
      for (const { view } of views.values()) {
        if (view.playing) {
          app.start();
          return;
        }
      }
      if ([...stones.values(), ...effects.values()].some((sprite) => sprite.playing)) {
        app.start();
        return;
      }
    }
    app.stop();
  }

  function refresh(snapshot: CharacterSceneSnapshot) {
    current = snapshot;
    const ids = new Set(snapshot.characters.map((frame) => frame.id));
    for (const [id, entry] of views) {
      if (!ids.has(id)) {
        entry.view.destroy();
        views.delete(id);
      }
    }
    for (const frame of snapshot.characters) {
      let entry = views.get(frame.id);
      if (entry !== undefined && entry.skin !== frame.skin) {
        entry.view.destroy();
        views.delete(frame.id);
        entry = undefined;
      }
      if (entry === undefined) {
        const frames = animations.get(frame.skin);
        if (frames === undefined) {
          throw new Error("캐릭터 에셋이 없습니다.");
        }
        const view = createCharacterView(frames, stunFrames);
        entry = { skin: frame.skin, view };
        views.set(frame.id, entry);
        app.stage.addChild(view.container);
      }
      entry.view.apply(frame, reduced(), !document.hidden);
    }
    const stoneIds = new Set((snapshot.projectiles ?? []).map((stone) => stone.id));
    removeMissing(stones, stoneIds);
    for (const stone of snapshot.projectiles ?? []) {
      if (!stones.has(stone.id)) {
        stones.set(stone.id, makeSprite(stoneFrames, `stone:${stone.id}`, true, 120));
      }
    }
    const effectIds = new Set((snapshot.effects ?? []).map((effect) => effect.id));
    removeMissing(effects, effectIds);
    for (const effect of snapshot.effects ?? []) {
      if (!effects.has(effect.id)) {
        const sprite = makeSprite(effect.kind === "impact" ? impactFrames : dustFrames, `effect:${effect.id}`, false, 75);
        if (effect.kind === "dust") {
          decorative.add(sprite);
          syncSprite(sprite);
        }
        effects.set(effect.id, sprite);
      }
    }
    const names = snapshot.characters.map((frame) => frame.skin === "mochi" ? "모찌" : "민트");
    app.canvas.setAttribute("aria-label", names.length === 0 ? "표시된 캐릭터 없음" : `${names.join("와 ")} 캐릭터`);
    app.canvas.setAttribute("aria-description", `${snapshot.characters.map((frame) => `${frame.skin === "mochi" ? "모찌" : "민트"}: ${frame.motion.kind}`).join(", ")}, 돌 ${snapshot.projectiles?.length ?? 0}개, 효과 ${snapshot.effects?.length ?? 0}개`);
  }

  function paint() {
    if (current === undefined) {
      return;
    }
    const { width, height } = current.bounds;
    const scale = Math.min(app.screen.width / width, app.screen.height / height);
    const left = (app.screen.width - width * scale) / 2;
    const top = (app.screen.height - height * scale) / 2;
    const size = Math.min(CHARACTER_SIZE_PX, width / 2, height) * scale;
    for (const frame of current.characters) {
      views.get(frame.id)?.view.layout(left + frame.position.x * scale, top + frame.position.y * scale, size);
    }
    for (const stone of current.projectiles ?? []) {
      const sprite = stones.get(stone.id);
      if (sprite !== undefined) {
        sprite.position.set(Math.round(left + stone.position.x * scale), Math.round(top + stone.position.y * scale));
        sprite.scale.set(32 * scale / sprite.texture.orig.height);
      }
    }
    for (const effect of current.effects ?? []) {
      const sprite = effects.get(effect.id);
      if (sprite !== undefined) {
        sprite.position.set(Math.round(left + effect.position.x * scale), Math.round(top + effect.position.y * scale));
        sprite.scale.set(64 * scale / sprite.texture.orig.height);
      }
    }
  }

  function draw() {
    if (!ready || disposed || failed) {
      return;
    }
    try {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      app.renderer.resize(width, height, window.devicePixelRatio || 1);
      refresh(supplied ?? initialCharacterScene(width, height));
      syncMotion();
    } catch (error) {
      fail(error);
    }
  }

  async function loadSheet(atlas: SpritesheetData, imageUrl: string): Promise<Spritesheet | undefined> {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    if (disposed || failed) {
      return;
    }
    // 이 장면만 소유한 texture를 사용한다. 다른 장면의 공유 Assets 캐시는 파괴하지 않는다.
    const sheet = new Spritesheet(new Texture({
      source: new ImageSource({ resource: image, scaleMode: "nearest" }),
    }), atlas);
    sheets.push(sheet);
    await sheet.parse();
    return sheet;
  }

  function characterAnimations(sheet: Spritesheet): CharacterAnimations {
    function frames(name: string): Texture[] {
      const textures = sheet.animations[name];
      if (textures === undefined || textures.length === 0) {
        throw new Error(`${name} 프레임이 없습니다.`);
      }
      return textures;
    }
    return {
      idle: frames("idle"),
      walk: frames("walk"),
      melee: frames("melee"),
      throw: frames("throw"),
      hit: frames("hit"),
    };
  }

  async function start() {
    onStatus("loading");
    try {
      await app.init({
        preference: "webgl",
        backgroundAlpha: 0,
        antialias: false,
        autoDensity: true,
        autoStart: false,
        sharedTicker: false,
        resolution: window.devicePixelRatio || 1,
      });
      initialized = true;
      if (disposed || failed) {
        return;
      }

      const mochi = await loadSheet(mochiAtlas, mochiImage);
      if (disposed || failed || mochi === undefined) {
        return;
      }
      animations.set("mochi", characterAnimations(mochi));
      const mint = await loadSheet(mintAtlas, mintImage);
      if (disposed || failed || mint === undefined) {
        return;
      }
      animations.set("mint", characterAnimations(mint));
      const effectSheet = await loadSheet(effectsAtlas, effectsImage);
      if (disposed || failed || effectSheet === undefined) {
        return;
      }
      stunFrames = effectSheet.animations.stun ?? [];
      if (stunFrames.length === 0) {
        throw new Error("기절 이펙트 프레임이 없습니다.");
      }
      impactFrames = effectSheet.animations.impact ?? [];
      dustFrames = effectSheet.animations.dust ?? [];
      const props = await loadSheet(propsAtlas, propsImage);
      if (disposed || failed || props === undefined) {
        return;
      }
      stoneFrames = props.animations["stone-gray"] ?? [];
      if (impactFrames.length === 0 || dustFrames.length === 0 || stoneFrames.length === 0) {
        throw new Error("전투 이펙트 프레임이 없습니다.");
      }
      app.stage.eventMode = "none";
      app.ticker.maxFPS = 30;
      app.ticker.add((ticker) => {
        try {
          for (const { view } of views.values()) {
            view.update(ticker);
          }
          for (const sprite of [...stones.values(), ...effects.values()]) {
            if (sprite.playing) {
              sprite.update(ticker);
            }
          }
          paint();
          syncTicker();
        } catch (error) {
          fail(error);
        }
      });
      app.canvas.setAttribute("role", "img");
      app.canvas.addEventListener("webglcontextlost", onContextLost);
      host.append(app.canvas);
      observer = new ResizeObserver(draw);
      observer.observe(host);
      window.addEventListener("resize", draw);
      reducedMotion.addEventListener("change", syncMotion);
      document.addEventListener("visibilitychange", syncMotion);
      ready = true;
      draw();
      stopPreferences = watchReducedEffects((reduced) => {
        reducedEffects = reduced;
        syncMotion();
      }, fail, target);
      if (ready && !disposed && !failed) {
        onStatus("ready");
      }
    } catch (error) {
      fail(error);
    } finally {
      initializing = false;
      if (disposed || failed) {
        release();
      }
    }
  }

  void start();
  return {
    update(snapshot) {
      if (disposed || failed) {
        return;
      }
      try {
        const { width, height } = snapshot.bounds;
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          throw new Error("캐릭터 장면의 크기가 유효하지 않습니다.");
        }
        const ids = new Set<string>();
        for (const frame of snapshot.characters) {
          if (ids.has(frame.id) || ![frame.position.x, frame.position.y, frame.facing.x, frame.facing.y].every(Number.isFinite)) {
            throw new Error("캐릭터 장면의 상태가 유효하지 않습니다.");
          }
          ids.add(frame.id);
        }
        for (const item of [...snapshot.projectiles ?? [], ...snapshot.effects ?? []]) {
          if (!Number.isFinite(item.position.x) || !Number.isFinite(item.position.y)) {
            throw new Error("전투 장면의 좌표가 유효하지 않습니다.");
          }
        }
        supplied = snapshot;
        if (ready) {
          refresh(snapshot);
          syncMotion();
        }
      } catch (error) {
        fail(error);
      }
    },
    dispose() {
      disposed = true;
      // 초기화·decode·atlas parse 도중에는 await가 끝난 후 자원을 정리한다.
      if (!initializing) {
        release();
      }
    },
  };
}
