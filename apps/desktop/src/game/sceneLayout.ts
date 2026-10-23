import type { WorldBounds } from "@deskbrawl/game-core";
import { CHARACTER_SIZE_PX } from "./characterScene";

export function sceneLayout(bounds: WorldBounds, width: number, height: number) {
  const scale = Math.min(width / bounds.width, height / bounds.height);
  return {
    scale,
    left: (width - bounds.width * scale) / 2,
    top: (height - bounds.height * scale) / 2,
    size: Math.min(CHARACTER_SIZE_PX, bounds.width / 2, bounds.height) * scale,
  };
}
