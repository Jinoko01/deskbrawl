import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PlayerInput } from "@deskbrawl/game-core";
import {
  localAvailable,
  localGameSupported,
  sendLocalCommand,
  watchLocalPlay,
  watchLocalKeys,
  watchLocalReset,
} from "../native/localGame";
import type { LocalCommand } from "../native/localGame";
import { loadControls, saveControls, watchControls } from "../native/controls";
import type { ControlsSnapshot } from "../native/controls";
import { createKeyboardInput } from "./keyboardInput";
import { controlsErrorMessage } from "./keyMap";
import type { Controls } from "./keyMap";

const zero = { x: 0, y: 0 } as const;

export function useLocalControls(onCommand?: (command: LocalCommand) => void) {
  const commandSink = useRef(onCommand);
  useLayoutEffect(() => {
    commandSink.current = onCommand;
  }, [onCommand]);
  const region = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // 조작키의 원본은 Rust 설정 파일이다. 여기서는 마지막으로 받은 값만 표시한다.
  const [controls, setControls] = useState<ControlsSnapshot>();
  const [controlsError, setControlsError] = useState<string>();
  const supported = localGameSupported();

  useEffect(() => {
    if (!supported) {
      return;
    }
    const keys = createKeyboardInput();
    let live = true;
    let available = false;
    let active = false;
    let pending = false;
    let sequence = 0;
    let revision = 0;
    let statusEvent = false;
    let queue = Promise.resolve();
    let unlisten: (() => void) | undefined;
    let unlistenPlay: (() => void) | undefined;
    let nativeCapture = false;
    let unlistenKeys: (() => void) | undefined;
    let unlistenControls: (() => void) | undefined;
    let controlsLoaded = false;
    let controlsEvent = false;

    function enqueue(kind: LocalCommand["kind"], movement: PlayerInput["movement"] = zero, action?: LocalCommand["action"], restore = false): Promise<void> {
      const command: LocalCommand = {
        kind,
        seq: ++sequence,
        movement,
        ...(action ? { action } : {}),
        ...(restore ? { restore } : {}),
      };
      const result = queue.then(async () => {
        await sendLocalCommand(command);
        commandSink.current?.(command);
      });
      queue = result.catch(() => {
        // 호출자가 실패를 표시한다. 다음 명령은 실패한 큐에 막히지 않게 한다.
      });
      return result;
    }

    function leave(restore = false): void {
      nativeCapture = false;
      revision++;
      const wasActive = active || pending;
      active = false;
      pending = false;
      keys.clear();
      if (live) {
        setPlaying(false);
        setBusy(false);
      }
      if (wasActive) {
        void enqueue("work", zero, undefined, restore).catch((cause: unknown) => {
          if (live) {
            setError(`작업 모드 전환 실패: ${String(cause)}`);
          }
        });
      }
    }

    function reset(nextReady: boolean): void {
      statusEvent = true;
      leave();
      available = nextReady;
      if (live) {
        setReady(nextReady);
        if (nextReady) {
          setError(undefined);
        }
      }
    }

    function applyControls(snapshot: ControlsSnapshot): void {
      // 키가 바뀌면 눌린 키 집합이 의미를 잃으므로 PLAY를 끝내고 다시 시작하게 한다.
      if (active || pending) {
        leave();
      }
      keys.setKeys(snapshot.controls.keys);
      controlsLoaded = snapshot.shortcut !== "loading";
      if (live) {
        setControls(snapshot);
        setControlsError(undefined);
      }
    }

    function start(): void {
      if (!controlsLoaded || !available || active || pending) {
        return;
      }
      pending = true;
      setBusy(true);
      setError(undefined);
      const current = ++revision;
      void enqueue("play").then(() => {
        if (!live || current !== revision) {
          return;
        }
        pending = false;
        active = true;
        setBusy(false);
        setPlaying(true);
      }).catch((cause: unknown) => {
        if (!live || current !== revision) {
          return;
        }
        setError(`플레이 시작 실패: ${String(cause)}`);
        leave();
      });
    }

    function requestPlay(): void {
      if (active || pending) {
        return;
      }
      if (!controlsLoaded || !available) {
        void enqueue("work").catch(inputFailed);
        return;
      }
      nativeCapture = true;
      start();
    }

    function onNativeKey(code: string, down: boolean): void {
      if (!active || !nativeCapture) {
        return;
      }
      const changed = down ? keys.press(code, false) : { changed: keys.release(code), action: undefined };
      if (changed.changed) {
        void enqueue("input", keys.movement(), changed.action).catch(inputFailed);
      }
    }
    function inputFailed(cause: unknown): void {
      if (live) {
        setError(`입력 전달 실패: ${String(cause)}`);
        leave();
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (!active) {
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        leave(true);
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      const result = keys.press(event.code, event.repeat, event.ctrlKey || event.altKey || event.metaKey);
      if (!result.handled) {
        return;
      }
      event.preventDefault();
      if (result.changed) {
        void enqueue("input", keys.movement(), result.action).catch((cause: unknown) => {
          if (live) {
            setError(`입력 전달 실패: ${String(cause)}`);
            leave();
          }
        });
      }
    }
    function onKeyUp(event: KeyboardEvent): void {
      if (!active || !keys.release(event.code)) {
        return;
      }
      event.preventDefault();
      void enqueue("input", keys.movement()).catch((cause: unknown) => {
        if (live) {
          setError(`입력 전달 실패: ${String(cause)}`);
          leave();
        }
      });
    }
    function onVisibility(): void {
      if (document.hidden && !nativeCapture) {
        leave();
      }
    }
    function onBlur(): void {
      if (!nativeCapture) {
        leave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    void (async () => {
      try {
        const stop = await watchLocalReset(reset);
        if (!live) {
          stop();
          return;
        }
        unlisten = stop;
        const stopKeys = await watchLocalKeys(onNativeKey, inputFailed);
        if (!live) {
          stopKeys();
          return;
        }
        unlistenKeys = stopKeys;
        const stopPlay = await watchLocalPlay(requestPlay);
        if (!live) {
          stopPlay();
          return;
        }
        unlistenPlay = stopPlay;
        const initial = await localAvailable();
        if (live && !statusEvent) {
          available = initial;
          setReady(initial);
        }
      } catch (cause) {
        if (live) {
          setError(`오버레이 상태 확인 실패: ${String(cause)}`);
        }
      }
    })();
    void (async () => {
      try {
        const stopControls = await watchControls((snapshot) => {
          controlsEvent = true;
          applyControls(snapshot);
        }, (cause) => {
          if (live) {
            setControlsError(`조작키 설정 확인 실패: ${String(cause)}`);
          }
        });
        if (!live) {
          stopControls();
          return;
        }
        unlistenControls = stopControls;
        const saved = await loadControls();
        // 조회 중 도착한 변경 이벤트가 더 최신이다.
        if (live && !controlsEvent) {
          applyControls(saved);
        }
      } catch (cause) {
        if (live) {
          setControlsError(`조작키 설정 확인 실패: ${String(cause)}`);
        }
      }
    })();
    return () => {
      leave();
      live = false;
      unlisten?.();
      unlistenPlay?.();
      unlistenKeys?.();
      unlistenControls?.();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supported]);

  // 실패하면 사용자에게 보여줄 문장을 던진다. 성공 시 새 값은 변경 이벤트로 도착한다.
  async function save(next: Controls): Promise<void> {
    try {
      await saveControls(next);
    } catch (cause) {
      throw new Error(controlsErrorMessage(String(cause)), { cause });
    }
  }

  return {
    region,
    ready,
    playing,
    busy,
    error,
    supported,
    controls,
    controlsError,
    save,
  };
}
