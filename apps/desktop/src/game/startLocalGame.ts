import { reportLocalReady, watchLocalCommands } from "../native/localGame";
import { createLocalGame } from "./localGame";
import type { MountedCharacterScene } from "./mountCharacter";
import { watchNetwork } from "../native/network";
import { createSnapshotView } from "./networkScene";
import { watchCharacterSkin } from "./characterPreference";
import type { CharacterSkin } from "./characterScene";

export function startLocalGame(host: HTMLElement, scene: MountedCharacterScene, onError: (error: unknown) => void,
  onModeChange?: (playing: boolean) => void): () => void {
  const game = createLocalGame(host.clientWidth, host.clientHeight, scene.update, () => {
    void reportLocalReady(true).catch(onError);
  });
  let disposed = false;
  let mode = "local";
  const network = createSnapshotView(scene.update);
  let stopNetwork: (() => void) | undefined;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopSkin: (() => void) | undefined;
  let skin: CharacterSkin = "mochi";
  function visibility() {
    if (document.hidden) {
      game.pause();
    }
    void reportLocalReady(!document.hidden).catch(onError);
  }
  void (async () => {
    try {
      const stop = await watchLocalCommands((command) => {
        if (command === "stop" || command.kind === "work") {
          onModeChange?.(false);
        } else if (command.kind === "play") {
          onModeChange?.(true);
        }
        if (mode === "local") {
          game.command(command);
        }
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      stopSkin = watchCharacterSkin((next) => {
        skin = next;
        if (mode === "local") {
          game.setSkin(next);
        }
      });
      const stopState = await watchNetwork((state) => {
        const previous = mode;
        mode = state.mode === "offline" ? "local" : state.mode;
        if (mode === "local") {
          if (previous !== "local") {
            network.dispose();
            game.setSkin(skin);
            game.resume();
          }
          return;
        }
        game.pause();
        if (state.snapshot !== null) {
          network.receive(state.snapshot);
        } else {
          network.dispose();
          scene.update({ bounds: game.world.bounds, characters: [] });
        }
      });
      if (disposed) {
        stopState();
        return;
      }
      stopNetwork = stopState;
      document.addEventListener("visibilitychange", visibility);
      timer = setInterval(() => {
        if (document.hidden || mode !== "local") {
          return;
        }
        try {
          game.advanceTime(performance.now());
        } catch (error) {
          game.pause();
          onError(error);
        }
      }, game.world.rules.tickMs);
      visibility();
    } catch (error) {
      if (!disposed) {
        onError(error);
      }
    }
  })();
  return () => {
    disposed = true;
    game.pause();
    if (timer !== undefined) {
      clearInterval(timer);
    }
    document.removeEventListener("visibilitychange", visibility);
    unlisten?.();
    stopNetwork?.();
    stopSkin?.();
    network.dispose();
    void reportLocalReady(false).catch((error: unknown) => console.error("Local status cleanup failed", error));
  };
}
