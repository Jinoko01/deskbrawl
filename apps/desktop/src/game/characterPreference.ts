import { characterSkinSchema } from "@deskbrawl/protocol";
import type { CharacterSkin } from "@deskbrawl/protocol";

const storageKey = "deskbrawl.character";

export function readCharacterSkin(): CharacterSkin {
  const saved = characterSkinSchema.safeParse(localStorage.getItem(storageKey));
  return saved.success ? saved.data : "mochi";
}

export function saveCharacterSkin(skin: CharacterSkin): void {
  localStorage.setItem(storageKey, characterSkinSchema.parse(skin));
}

export function watchCharacterSkin(onChange: (skin: CharacterSkin) => void): () => void {
  function changed(event: StorageEvent): void {
    if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) {
      onChange(readCharacterSkin());
    }
  }
  window.addEventListener("storage", changed);
  onChange(readCharacterSkin());
  return () => window.removeEventListener("storage", changed);
}
