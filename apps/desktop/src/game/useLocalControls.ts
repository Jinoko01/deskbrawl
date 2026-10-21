import { useEffect, useRef, useState } from "react";
import type { PlayerInput } from "@deskbrawl/game-core";
import { localAvailable, localGameSupported, sendLocalCommand, watchLocalPlay, watchLocalReset } from "../native/localGame";
import type { LocalCommand } from "../native/localGame";
import { createKeyboardInput } from "./keyboardInput";

const zero = { x: 0, y: 0 } as const;

export function useLocalControls() {
  const region = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const supported = localGameSupported();

  useEffect(() => {
    if (!supported) return;
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
    let awaitingFocus: (() => void) | undefined;

    function enqueue(kind: LocalCommand["kind"], movement: PlayerInput["movement"] = zero, action?: LocalCommand["action"]): Promise<void> {
      const command: LocalCommand = { kind, seq: ++sequence, movement, ...(action ? { action } : {}) };
      const result = queue.then(() => sendLocalCommand(command));
      queue = result.catch(() => {});
      return result;
    }

    function leave(): void {
      awaitingFocus?.();
      revision++;
      const wasActive = active || pending;
      active = false;
      pending = false;
      keys.clear();
      if (live) { setPlaying(false); setBusy(false); }
      if (wasActive) void enqueue("work").catch((cause: unknown) => {
        if (live) setError(`작업 모드 전환 실패: ${String(cause)}`);
      });
    }

    function reset(nextReady: boolean): void {
      statusEvent = true;
      leave();
      available = nextReady;
      if (live) { setReady(nextReady); if (nextReady) setError(undefined); }
    }

    function start(): void {
      if (!available || active || pending || !document.hasFocus() || document.hidden) return;
      pending = true;
      setBusy(true);
      setError(undefined);
      const current = ++revision;
      void enqueue("play").then(() => {
        if (!live || current !== revision) return;
        pending = false;
        active = true;
        setBusy(false);
        setPlaying(true);
        region.current?.focus();
      }).catch((cause: unknown) => {
        if (!live || current !== revision) return;
        setError(`플레이 시작 실패: ${String(cause)}`);
        leave();
      });
    }

    // 단축키로 조작 창이 앞으로 와도 WebView의 focus는 늦게 도착할 수 있다.
    function requestPlay(): void {
      if (active || pending) return;
      awaitingFocus?.();
      if (document.hasFocus()) { start(); return; }
      const timeout = setTimeout(() => awaitingFocus?.(), 1000);
      function onFocus(): void { awaitingFocus?.(); start(); }
      awaitingFocus = () => {
        clearTimeout(timeout);
        window.removeEventListener("focus", onFocus);
        awaitingFocus = undefined;
      };
      window.addEventListener("focus", onFocus);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (!active) return;
      if (event.code === "Escape") { event.preventDefault(); leave(); return; }
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const result = keys.press(event.code, event.repeat);
      if (!result.handled) return;
      event.preventDefault();
      if (result.changed) void enqueue("input", keys.movement(), result.action).catch((cause: unknown) => {
        if (live) { setError(`입력 전달 실패: ${String(cause)}`); leave(); }
      });
    }
    function onKeyUp(event: KeyboardEvent): void {
      if (!active || !keys.release(event.code)) return;
      event.preventDefault();
      void enqueue("input", keys.movement()).catch((cause: unknown) => {
        if (live) { setError(`입력 전달 실패: ${String(cause)}`); leave(); }
      });
    }
    function onVisibility(): void { if (document.hidden) leave(); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", leave);
    document.addEventListener("visibilitychange", onVisibility);
    void (async () => {
      try {
        const stop = await watchLocalReset(reset);
        if (!live) { stop(); return; }
        unlisten = stop;
        const stopPlay = await watchLocalPlay(requestPlay);
        if (!live) { stopPlay(); return; }
        unlistenPlay = stopPlay;
        const initial = await localAvailable();
        if (live && !statusEvent) { available = initial; setReady(initial); }
      } catch (cause) {
        if (live) setError(`오버레이 상태 확인 실패: ${String(cause)}`);
      }
    })();
    return () => {
      leave();
      live = false;
      unlisten?.();
      unlistenPlay?.();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", leave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [supported]);

  return { region, ready, playing, busy, error, supported };
}
