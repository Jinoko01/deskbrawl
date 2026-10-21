import { reportLocalReady, watchLocalCommands } from "../native/localGame";
import { createLocalGame } from "./localGame";
import type { MountedCharacterScene } from "./mountCharacter";

export function startLocalGame(host: HTMLElement, scene: MountedCharacterScene, onError: (error: unknown) => void): () => void {
  const game = createLocalGame(host.clientWidth, host.clientHeight, scene.update, () => {
    void reportLocalReady(true).catch(onError);
  });
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  function visibility() {
    if (document.hidden) game.pause();
    void reportLocalReady(!document.hidden).catch(onError);
  }
  void (async () => {
    try {
      const stop = await watchLocalCommands(game.command);
      if (disposed) { stop(); return; }
      unlisten = stop;
      document.addEventListener("visibilitychange", visibility);
      timer = setInterval(() => {
        if (document.hidden) return;
        try { game.advanceTime(performance.now()); }
        catch (error) { game.pause(); onError(error); }
      }, game.world.rules.tickMs);
      visibility();
    } catch (error) { if (!disposed) onError(error); }
  })();
  return () => {
    disposed = true;
    game.pause();
    if (timer !== undefined) clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
    unlisten?.();
    void reportLocalReady(false).catch((error: unknown) => console.error("Local status cleanup failed", error));
  };
}
