import { MAX_HP } from "@deskbrawl/game-core";
import type { PlayerState, Vector2, WorldState } from "@deskbrawl/game-core";
import effectsAtlas from "../../../packages/game-assets/effects/effects-v2.json";
import effectsUrl from "../../../packages/game-assets/effects/effects-v2.png";
import propsAtlas from "../../../packages/game-assets/props/props-v2.json";
import propsUrl from "../../../packages/game-assets/props/props-v2.png";

export const SKINS = ["mochi", "mint", "sunny", "coral", "lumi", "rusty", "byte", "berry"] as const;
export type Skin = typeof SKINS[number];
export const SKIN_NAMES: Record<Skin, string> = {
  mochi: "모찌", mint: "민트", sunny: "써니", coral: "코랄", lumi: "루미", rusty: "러스티", byte: "바이트", berry: "베리",
};

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
interface Atlas {
  readonly frames: Readonly<Record<string, {
    readonly frame: Rect;
    readonly spriteSourceSize: Rect;
    readonly sourceSize: { readonly w: number; readonly h: number };
  }>>;
  readonly animations: Readonly<Record<string, readonly string[]>>;
}
interface Sheet {
  readonly atlas: Atlas;
  readonly image: HTMLImageElement;
}
type Animation = "idle" | "walk" | "melee" | "throw" | "hit";

// 에셋에 기록된 감상용 간격(packages/game-assets/README.md). 판정에는 쓰지 않는다.
const FRAME_MS: Record<Animation, number> = { idle: 220, walk: 120, melee: 100, throw: 150, hit: 220 };
const STONE_PX = 32;
const EFFECT_PX = 64;

const CHARACTERS = "../../../packages/game-assets/characters/";
const atlasLoaders = import.meta.glob<Atlas>("../../../packages/game-assets/characters/*-v2.json", { import: "default" });
const imageLoaders = import.meta.glob<string>("../../../packages/game-assets/characters/*-v2.png", { query: "?url", import: "default" });

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

const loading = new Map<Skin, Promise<Sheet>>();
const loaded = new Map<Skin, Sheet>();

// 캐릭터 시트는 장당 1MB가 넘어 고른 것만 불러온다.
export function loadSkin(skin: Skin): Promise<Sheet> {
  let sheet = loading.get(skin);
  if (sheet === undefined) {
    const atlas = atlasLoaders[`${CHARACTERS}${skin}-v2.json`];
    const image = imageLoaders[`${CHARACTERS}${skin}-v2.png`];
    if (atlas === undefined || image === undefined) {
      return Promise.reject(new Error(`캐릭터 에셋이 없습니다: ${skin}`));
    }
    sheet = Promise.all([atlas(), image().then(loadImage)]).then(([atlasData, imageData]) => {
      const ready = { atlas: atlasData, image: imageData };
      loaded.set(skin, ready);
      return ready;
    });
    loading.set(skin, sheet);
  }
  return sheet;
}

// 원본 표시 영역(sourceSize)의 중심을 (cx, cy)에 맞춰 그린다. 데스크톱 앱의 캐릭터 배치와 같다.
function drawFrame(
  context: CanvasRenderingContext2D, sheet: Sheet, key: string | undefined,
  cx: number, cy: number, size: number, flip = false,
): void {
  const entry = key === undefined ? undefined : sheet.atlas.frames[key];
  if (entry === undefined) {
    return;
  }
  const { frame, spriteSourceSize: placed, sourceSize } = entry;
  const scale = size / sourceSize.h;
  context.save();
  context.translate(Math.round(cx), Math.round(cy));
  if (flip) {
    context.scale(-1, 1);
  }
  context.drawImage(
    sheet.image, frame.x, frame.y, frame.w, frame.h,
    (placed.x - sourceSize.w / 2) * scale, (placed.y - sourceSize.h / 2) * scale, frame.w * scale, frame.h * scale,
  );
  context.restore();
}

export function drawPortrait(canvas: HTMLCanvasElement, skin: Skin): void {
  const sheet = loaded.get(skin);
  const context = canvas.getContext("2d");
  if (sheet === undefined || context === null) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  drawFrame(context, sheet, sheet.atlas.animations.idle?.[0], canvas.width / 2, canvas.height / 2, canvas.height);
}

export interface Scene {
  readonly world: WorldState;
  readonly previous: readonly PlayerState[];
  // 보간이 끝난 화면 좌표. 캐릭터 id → 충돌 영역 중심.
  readonly positions: ReadonlyMap<string, Vector2>;
  readonly skins: Readonly<Record<string, Skin>>;
  readonly size: number;
  readonly alpha: number;
  readonly now: number;
  readonly reduced: boolean;
}

export async function createRenderer(canvas: HTMLCanvasElement) {
  const maybeContext = canvas.getContext("2d");
  if (maybeContext === null) {
    throw new Error("캔버스를 사용할 수 없습니다.");
  }
  const context: CanvasRenderingContext2D = maybeContext;
  const [effectsImage, propsImage] = await Promise.all([loadImage(effectsUrl), loadImage(propsUrl)]);
  const effects: Sheet = { atlas: effectsAtlas, image: effectsImage };
  const props: Sheet = { atlas: propsAtlas, image: propsImage };
  const directions = new Map<string, boolean>();

  function loop(frames: readonly string[] | undefined, ms: number, scene: Scene): string | undefined {
    return frames?.[scene.reduced ? 0 : Math.floor(scene.now / ms) % frames.length];
  }

  function character(scene: Scene, player: PlayerState, center: Vector2): void {
    const skin = scene.skins[player.id];
    const sheet = skin === undefined ? undefined : loaded.get(skin);
    if (sheet === undefined) {
      return;
    }
    const { world } = scene;
    const tickMs = world.rules.tickMs;
    const before = scene.previous.find((entry) => entry.id === player.id);
    const moving = before !== undefined && (before.position.x !== player.position.x || before.position.y !== player.position.y);
    const since = (tick: number): number => (world.tick - tick + scene.alpha) * tickMs;
    const last = player.lastAction;
    // apps/desktop/src/game/localGame.ts의 motion()과 같은 우선순위다.
    let name: Animation = moving ? "walk" : "idle";
    let elapsed: number | undefined;
    let stunned = false;
    if (player.hp === 0) {
      stunned = true;
    } else if (world.tick < player.knockbackUntilTick) {
      name = "hit";
      elapsed = since(player.lastHitTick ?? world.tick);
    } else if (world.tick < player.stunnedUntilTick) {
      stunned = true;
    } else if (last !== null && since(last.tick) < (last.kind === "melee" ? 400 : 300)) {
      name = last.kind === "melee" ? "melee" : "throw";
      elapsed = since(last.tick);
    }
    if (stunned) {
      name = "hit";
    }
    const frames = sheet.atlas.animations[name] ?? [];
    let key = loop(frames, FRAME_MS[name], scene);
    if (stunned) {
      key = frames[frames.length - 1];
    } else if (elapsed !== undefined) {
      key = frames[Math.min(frames.length - 1, Math.floor(elapsed / FRAME_MS[name]))];
    }
    if (player.facing.x !== 0) {
      directions.set(player.id, player.facing.x < 0);
    }
    const { size } = scene;
    drawFrame(context, sheet, key, center.x, center.y, size, directions.get(player.id) ?? false);
    if (stunned) {
      drawFrame(context, effects, loop(effects.atlas.animations.stun, 120, scene), center.x, center.y - size * 0.65, size * 0.55);
    }
    if (player.hp < MAX_HP) {
      const width = size * 0.65;
      const height = Math.max(4, size * 0.06);
      const left = Math.round(center.x - width / 2);
      const top = Math.round(center.y + size * 0.42);
      context.fillStyle = "#171923";
      context.fillRect(left, top, width, height);
      context.fillStyle = "#8dde8c";
      context.fillRect(left + 1, top + 1, (width - 2) * player.hp / MAX_HP, height - 2);
    }
  }

  return {
    resize(width: number, height: number): void {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
    draw(scene: Scene): void {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      const { world } = scene;
      const ordered = [...world.players].sort((a, b) => a.position.y - b.position.y);
      for (const player of ordered) {
        character(scene, player, scene.positions.get(player.id) ?? player.position);
      }
      for (const stone of world.projectiles) {
        drawFrame(context, props, loop(props.atlas.animations["stone-gray"], 120, scene), stone.position.x, stone.position.y, STONE_PX);
      }
      for (const effect of world.effects) {
        const frames = effects.atlas.animations[effect.kind] ?? [];
        const index = Math.floor((world.tick - effect.startedAtTick + scene.alpha) * world.rules.tickMs / 75);
        drawFrame(context, effects, frames[Math.min(frames.length - 1, Math.max(0, index))], effect.position.x, effect.position.y, EFFECT_PX);
      }
    },
  };
}
