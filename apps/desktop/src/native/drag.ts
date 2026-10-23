import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Vector2 } from "@deskbrawl/game-core";

export type DragRegion = [id: string, left: number, top: number, right: number, bottom: number];
export interface CharacterDrag {
  id: string;
  dx: number;
  dy: number;
  phase: "start" | "move" | "end";
}

export async function publishDragRegions(regions: DragRegion[]): Promise<void> {
  if (isTauri()) {
    await invoke("overlay_drag_regions", { regions });
  }
}

export async function watchCharacterDrag(receive: (drag: CharacterDrag) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에는 네이티브 드래그 구독이 없다. */ };
  }
  return listen<unknown>("character-drag", ({ payload }) => {
    if (!Array.isArray(payload) || payload.length !== 4) {
      return;
    }
    const [id, dx, dy, phase] = payload as unknown[];
    if (typeof id === "string" && typeof dx === "number" && Number.isFinite(dx)
      && typeof dy === "number" && Number.isFinite(dy) && (phase === "start" || phase === "move" || phase === "end")) {
      receive({
        id, dx, dy, phase,
      });
    }
  });
}

export async function placeNetworkCharacter(playerId: string, position: Vector2): Promise<void> {
  if (isTauri()) {
    await invoke("overlay_place", { playerId, x: position.x, y: position.y });
  }
}

export async function watchCharacterPlacement(receive: (position: Vector2) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에는 네이티브 드래그 구독이 없다. */ };
  }
  return listen<unknown>("character-place", ({ payload }) => {
    if (!Array.isArray(payload) || payload.length !== 2) {
      return;
    }
    const [x, y] = payload as unknown[];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      receive({ x, y });
    }
  });
}
