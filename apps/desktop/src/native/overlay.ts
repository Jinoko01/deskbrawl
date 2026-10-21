import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function watchReducedEffects(
  onChange: (reduced: boolean) => void,
  onError: (error: unknown) => void,
  target: "overlay" | "preview" = "overlay",
): () => void {
  if (!isTauri()) {
    onChange(false);
    return () => { /* 브라우저에서는 네이티브 구독이 없어 정리할 자원이 없다. */ };
  }
  let disposed = false;
  let changed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const stop = await listen<unknown>("overlay-effects-changed", (event) => {
        if (disposed) {
          return;
        }
        if (typeof event.payload !== "boolean") {
          onError(new Error("Invalid effects preference"));
          return;
        }
        changed = true;
        onChange(event.payload);
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      const reduced = await invoke<unknown>(target === "overlay" ? "overlay_reduced_effects" : "preview_reduced_effects");
      if (typeof reduced !== "boolean") {
        throw new Error("Invalid effects preference");
      }
      // A live event received during the initial query wins over that snapshot.
      if (!disposed && !changed) {
        onChange(reduced);
      }
    } catch (error) {
      if (!disposed) {
        onError(error);
      }
    }
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export async function reportRendererFailure(): Promise<void> {
  if (isTauri()) {
    await invoke("overlay_renderer_failed");
  }
}
