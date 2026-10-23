import { reportLocalReady, watchLocalCommands } from "../native/localGame";
import { createLocalGame } from "./localGame";
import type { MountedCharacterScene } from "./mountCharacter";
import { watchNetwork } from "../native/network";
import { createSnapshotView } from "./networkScene";
import { watchCharacterSkin } from "./characterPreference";
import type { CharacterSkin } from "./characterScene";
import type { CharacterSceneSnapshot } from "./characterScene";
import type { Vector2 } from "@deskbrawl/game-core";
import { sceneLayout } from "./sceneLayout";
import { placeNetworkCharacter, publishDragRegions, watchCharacterDrag } from "../native/drag";
import type { DragRegion } from "../native/drag";

export function startLocalGame(host: HTMLElement, scene: MountedCharacterScene, onError: (error: unknown) => void,
  onModeChange?: (playing: boolean) => void): () => void {
  let disposed = false;
  let mode = "local";
  let playing = false;
  let playerId: string | undefined;
  let currentScene: CharacterSceneSnapshot | undefined;
  let activeDrag: { id: string; position: Vector2; scale: number } | undefined;
  let regionQueue = Promise.resolve();
  const render = (snapshot: CharacterSceneSnapshot) => {
    currentScene = snapshot;
    scene.update(snapshot);
    updateRegions();
  };
  const game = createLocalGame(host.clientWidth, host.clientHeight, render, () => {
    setPlaying(false);
    void reportLocalReady(true).catch(onError);
  });
  const network = createSnapshotView(render);
  let stopNetwork: (() => void) | undefined;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopSkin: (() => void) | undefined;
  let stopDrag: (() => void) | undefined;
  let skin: CharacterSkin = "mochi";
  function updateRegions(): void {
    const snapshot = currentScene;
    const regions: DragRegion[] = [];
    if (!disposed && snapshot !== undefined && !playing && (mode === "local" || mode === "host" || mode === "guest")) {
      const {
        left, top, scale, size,
      } = sceneLayout(snapshot.bounds, host.clientWidth, host.clientHeight);
      for (const frame of snapshot.characters) {
        if ((mode !== "local" && frame.id !== playerId) || frame.motion.kind === "stun" || frame.motion.kind === "hit") {
          continue;
        }
        const x = left + frame.position.x * scale;
        const y = top + frame.position.y * scale;
        const half = size / 2;
        regions.push([frame.id, Math.max(0, x - half), Math.max(0, y - half), Math.min(host.clientWidth, x + half), Math.min(host.clientHeight, y + half)]);
      }
    }
    regionQueue = regionQueue.then(() => publishDragRegions(disposed ? [] : regions)).catch((error: unknown) => {
      if (!disposed) {
        onError(error);
      }
    });
  }
  function setPlaying(next: boolean): void {
    playing = next;
    activeDrag = undefined;
    onModeChange?.(next);
    updateRegions();
  }
  function visibility() {
    if (document.hidden) {
      setPlaying(false);
      game.pause();
    }
    void reportLocalReady(!document.hidden).catch(onError);
  }
  void (async () => {
    try {
      const stop = await watchLocalCommands((command) => {
        if (command === "stop" || command.kind === "work") {
          setPlaying(false);
        } else if (command.kind === "play") {
          setPlaying(mode !== "recovering");
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
      const unwatchDrag = await watchCharacterDrag((drag) => {
        const snapshot = currentScene;
        if (playing || snapshot === undefined || (mode !== "local" && drag.id !== playerId)
          || !["local", "host", "guest"].includes(mode)) {
          activeDrag = undefined;
          return;
        }
        const frame = snapshot.characters.find((frame) => frame.id === drag.id);
        if (frame === undefined || frame.motion.kind === "stun" || frame.motion.kind === "hit") {
          activeDrag = undefined;
          return;
        }
        if (drag.phase === "start") {
          activeDrag = { id: drag.id, position: frame.position, scale: sceneLayout(snapshot.bounds, host.clientWidth, host.clientHeight).scale };
          return;
        }
        if (activeDrag?.id !== drag.id || activeDrag.scale <= 0) {
          return;
        }
        const radius = game.world.rules.playerRadius;
        const position = {
          x: Math.max(radius, Math.min(snapshot.bounds.width - radius, activeDrag.position.x + drag.dx / activeDrag.scale)),
          y: Math.max(radius, Math.min(snapshot.bounds.height - radius, activeDrag.position.y + drag.dy / activeDrag.scale)),
        };
        if (mode === "local") {
          game.place(drag.id, position);
        } else {
          void placeNetworkCharacter(drag.id, position).catch((error: unknown) => {
            if (error !== "WORK_ONLY" && error !== "OWN_CHARACTER_ONLY" && !disposed) {
              onError(error);
            }
          });
        }
        if (drag.phase === "end") {
          activeDrag = undefined;
        }
      });
      if (disposed) {
        unwatchDrag();
        return;
      }
      stopDrag = unwatchDrag;
      stopSkin = watchCharacterSkin((next) => {
        skin = next;
        if (mode === "local") {
          game.setSkin(next);
        }
      });
      const stopState = await watchNetwork((state) => {
        const previous = mode;
        mode = state.mode === "offline" ? "local" : state.mode;
        playerId = state.playerId;
        if (previous !== mode) {
          setPlaying(false);
        }
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
          render({ bounds: game.world.bounds, characters: [] });
        }
      });
      if (disposed) {
        stopState();
        return;
      }
      stopNetwork = stopState;
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("resize", updateRegions);
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
    setPlaying(false);
    game.pause();
    if (timer !== undefined) {
      clearInterval(timer);
    }
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("resize", updateRegions);
    unlisten?.();
    stopNetwork?.();
    stopSkin?.();
    stopDrag?.();
    void publishDragRegions([]).catch((error: unknown) => console.error("드래그 영역 정리 실패", error));
    network.dispose();
    void reportLocalReady(false).catch((error: unknown) => console.error("Local status cleanup failed", error));
  };
}
