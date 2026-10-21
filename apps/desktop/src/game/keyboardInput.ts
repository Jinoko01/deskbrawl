import type { PlayerAction, PlayerInput } from "@deskbrawl/game-core";

export function createKeyboardInput() {
  const held = new Set<string>();
  const codes = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyZ", "KeyX"]);
  return {
    press(code: string, repeat: boolean): { handled: boolean; changed: boolean; action?: PlayerAction } {
      if (!codes.has(code)) return { handled: false, changed: false };
      if (repeat || held.has(code)) return { handled: true, changed: false };
      held.add(code);
      return { handled: true, changed: true, ...(code === "KeyZ" ? { action: "melee" as const } : code === "KeyX" ? { action: "stone" as const } : {}) };
    },
    release(code: string): boolean { return held.delete(code); },
    clear(): void { held.clear(); },
    movement(): PlayerInput["movement"] {
      return { x: (Number(held.has("ArrowRight")) - Number(held.has("ArrowLeft"))) as -1 | 0 | 1,
        y: (Number(held.has("ArrowDown")) - Number(held.has("ArrowUp"))) as -1 | 0 | 1 };
    },
  };
}
