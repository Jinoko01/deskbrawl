import type { PlayerAction, PlayerInput } from "@deskbrawl/game-core";
import { DEFAULT_CONTROLS } from "./keyMap";
import type { GameKeys } from "./keyMap";

export function createKeyboardInput(initial: GameKeys = DEFAULT_CONTROLS.keys) {
  const held = new Set<string>();
  let keys = initial;
  return {
    // Ctrl·Alt·Meta와 함께 누른 키는 Ctrl+Z 같은 앱 단축키이므로 게임 입력으로 쓰지 않는다.
    press(code: string, repeat: boolean, modified = false): { handled: boolean; changed: boolean; action?: PlayerAction } {
      if (modified || !Object.values(keys).includes(code)) return { handled: false, changed: false };
      if (repeat || held.has(code)) return { handled: true, changed: false };
      held.add(code);
      return { handled: true, changed: true, ...(code === keys.melee ? { action: "melee" as const } : code === keys.stone ? { action: "stone" as const } : {}) };
    },
    release(code: string): boolean { return held.delete(code); },
    clear(): void { held.clear(); },
    setKeys(next: GameKeys): void { keys = next; held.clear(); },
    movement(): PlayerInput["movement"] {
      return { x: (Number(held.has(keys.right)) - Number(held.has(keys.left))) as -1 | 0 | 1,
        y: (Number(held.has(keys.down)) - Number(held.has(keys.up))) as -1 | 0 | 1 };
    },
  };
}
