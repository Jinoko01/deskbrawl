import { expect, it } from "vitest";
import { characterSkinSchema } from "@deskbrawl/protocol";
import type { CharacterSkin } from "@deskbrawl/protocol";
import { adjacentCharacter, characterPortrait, CHARACTERS } from "./characters";

it("cycles through all eight characters in both directions and wraps at either end", () => {
  const seen = [];
  let skin: CharacterSkin = "mochi";
  for (let index = 0; index < 8; index++) {
    seen.push(skin);
    const next = adjacentCharacter(skin, 1);
    expect(adjacentCharacter(next, -1)).toBe(skin);
    skin = next;
  }
  expect(seen).toEqual(characterSkinSchema.options);
  expect(skin).toBe("mochi");
  expect(adjacentCharacter("mochi", -1)).toBe("berry");
});

it("provides a named, correctly cropped portrait and every game animation for all eight assets", () => {
  expect(Object.keys(CHARACTERS)).toHaveLength(8);
  for (const skin of characterSkinSchema.options) {
    const {
      frame, size, image, name,
    } = characterPortrait(skin);
    expect(image).toContain(`${skin}-v2.png`);
    expect(name.length).toBeGreaterThan(0);
    expect(frame.w).toBeGreaterThan(0);
    expect(frame.h).toBeGreaterThan(0);
    expect(frame.x + frame.w).toBeLessThanOrEqual(size.w);
    expect(frame.y + frame.h).toBeLessThanOrEqual(size.h);
    for (const motion of ["idle", "walk", "melee", "throw", "hit"]) {
      const frames = CHARACTERS[skin].atlas.animations?.[motion];
      expect(frames?.length).toBeGreaterThan(0);
      for (const key of frames ?? []) {
        expect(CHARACTERS[skin].atlas.frames[key]).toBeDefined();
      }
    }
  }
});
