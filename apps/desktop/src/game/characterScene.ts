import type {
  PlayerState,
  ProjectileState,
  WorldBounds,
  WorldEffect,
} from "@deskbrawl/game-core";

export type { CharacterSkin } from "@deskbrawl/protocol";
import type { CharacterSkin } from "@deskbrawl/protocol";
import { MAX_HP } from "@deskbrawl/game-core";

export type CharacterMotion =
  | { readonly kind: "idle" | "walk" | "stun" }
  | { readonly kind: "melee" | "throw" | "hit"; readonly actionId: string };

// 게임 판정과 분리된 표현 모델. actionId는 동일한 단발 모션의 새 재생을 구분한다.
export interface CharacterFrame extends Pick<PlayerState, "id" | "position" | "facing"> {
  readonly hp?: number;
  readonly skin: CharacterSkin;
  readonly motion: CharacterMotion;
  readonly nickname?: string;
  readonly chat?: { readonly current: string; readonly previous: string; readonly opacity: number };
}

export interface CharacterSceneSnapshot {
  readonly bounds: WorldBounds;
  readonly characters: readonly CharacterFrame[];
  readonly projectiles?: readonly ProjectileState[];
  readonly effects?: readonly WorldEffect[];
}

// M0의 표시 크기를 유지한다. 제품의 최종 캐릭터 크기·충돌 반지름을 정하는 값은 아니다.
export const CHARACTER_SIZE_PX = 96;

export function sameCharacterScene(a: CharacterSceneSnapshot | undefined, b: CharacterSceneSnapshot): boolean {
  if (
    a?.bounds.width !== b.bounds.width
    || a.bounds.height !== b.bounds.height
    || a.characters.length !== b.characters.length
    || a.projectiles?.length !== b.projectiles?.length
    || a.effects?.length !== b.effects?.length
  ) {
    return false;
  }
  return a.characters.every((frame, index) => {
    const other = b.characters[index];
    return frame.id === other?.id
      && frame.hp === other.hp
      && frame.skin === other.skin
      && frame.nickname === other.nickname
      && frame.chat?.current === other.chat?.current
      && frame.chat?.previous === other.chat?.previous
      && frame.chat?.opacity === other.chat?.opacity
      && frame.position.x === other.position.x
      && frame.position.y === other.position.y
      && frame.facing.x === other.facing.x
      && frame.facing.y === other.facing.y
      && frame.motion.kind === other.motion.kind
      && ("actionId" in frame.motion ? frame.motion.actionId : undefined) === ("actionId" in other.motion ? other.motion.actionId : undefined);
  }) && (a.projectiles ?? []).every((stone, index) => {
    const other = b.projectiles?.[index];
    return stone.id === other?.id && stone.position.x === other.position.x && stone.position.y === other.position.y;
  }) && (a.effects ?? []).every((effect, index) => effect.id === b.effects?.[index]?.id);
}

export function initialCharacterScene(width: number, height: number): CharacterSceneSnapshot {
  const size = Math.min(CHARACTER_SIZE_PX, width / 2, height);
  const offset = Math.min(size * 0.75, (width - size) / 2);
  return {
    bounds: { width, height },
    characters: [
      {
        id: "host",
        hp: MAX_HP,
        skin: "mochi",
        position: { x: width / 2 - offset, y: height / 2 },
        facing: { x: 1, y: 0 },
        motion: { kind: "idle" },
      },
      {
        id: "guest",
        hp: MAX_HP,
        skin: "mint",
        position: { x: width / 2 + offset, y: height / 2 },
        facing: { x: -1, y: 0 },
        motion: { kind: "idle" },
      },
    ],
  };
}
