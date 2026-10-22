import { characterSkinSchema } from "@deskbrawl/protocol";
import type { CharacterSkin } from "@deskbrawl/protocol";
import type { SpritesheetData } from "pixi.js";
import mochiAtlas from "../../../../packages/game-assets/characters/mochi-v2.json";
import mochiImage from "../../../../packages/game-assets/characters/mochi-v2.png";
import mintAtlas from "../../../../packages/game-assets/characters/mint-v2.json";
import mintImage from "../../../../packages/game-assets/characters/mint-v2.png";
import sunnyAtlas from "../../../../packages/game-assets/characters/sunny-v2.json";
import sunnyImage from "../../../../packages/game-assets/characters/sunny-v2.png";
import coralAtlas from "../../../../packages/game-assets/characters/coral-v2.json";
import coralImage from "../../../../packages/game-assets/characters/coral-v2.png";
import lumiAtlas from "../../../../packages/game-assets/characters/lumi-v2.json";
import lumiImage from "../../../../packages/game-assets/characters/lumi-v2.png";
import rustyAtlas from "../../../../packages/game-assets/characters/rusty-v2.json";
import rustyImage from "../../../../packages/game-assets/characters/rusty-v2.png";
import byteAtlas from "../../../../packages/game-assets/characters/byte-v2.json";
import byteImage from "../../../../packages/game-assets/characters/byte-v2.png";
import berryAtlas from "../../../../packages/game-assets/characters/berry-v2.json";
import berryImage from "../../../../packages/game-assets/characters/berry-v2.png";

interface CharacterAsset {
  readonly name: string;
  readonly atlas: SpritesheetData;
  readonly image: string;
}

export const CHARACTERS: Record<CharacterSkin, CharacterAsset> = {
  mochi: { name: "모찌", atlas: mochiAtlas, image: mochiImage },
  mint: { name: "민트", atlas: mintAtlas, image: mintImage },
  sunny: { name: "써니", atlas: sunnyAtlas, image: sunnyImage },
  coral: { name: "코랄", atlas: coralAtlas, image: coralImage },
  lumi: { name: "루미", atlas: lumiAtlas, image: lumiImage },
  rusty: { name: "러스티", atlas: rustyAtlas, image: rustyImage },
  byte: { name: "바이트", atlas: byteAtlas, image: byteImage },
  berry: { name: "베리", atlas: berryAtlas, image: berryImage },
};

export function adjacentCharacter(skin: CharacterSkin, direction: -1 | 1): CharacterSkin {
  const skins = characterSkinSchema.options;
  return skins[(skins.indexOf(skin) + direction + skins.length) % skins.length] ?? "mochi";
}

export function characterPortrait(skin: CharacterSkin) {
  const { atlas, image, name } = CHARACTERS[skin];
  const idle = atlas.animations?.idle?.[0];
  const frame = idle === undefined ? undefined : atlas.frames[idle]?.frame;
  const size = atlas.meta.size;
  if (frame === undefined || size === undefined) {
    throw new Error(`캐릭터 미리보기 에셋이 올바르지 않습니다: ${skin}`);
  }
  return {
    image, name, frame, size,
  };
}
