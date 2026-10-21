import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { GAME_ACTIONS } from "../game/keyMap";
import type { Controls } from "../game/keyMap";

// loading: 저장된 설정을 읽는 중, unavailable: 다른 앱 점유 등으로 전역 단축키 등록 실패.
export type ShortcutStatus = "loading" | "registered" | "unavailable";

export interface ControlsSnapshot {
  readonly controls: Controls;
  readonly shortcut: ShortcutStatus;
}

export function parseControls(value: unknown): ControlsSnapshot {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("Invalid controls");
  }
  const [codes, shortcut] = value as unknown[];
  if (!Array.isArray(codes) || codes.length !== GAME_ACTIONS.length + 1
    || !codes.every((code) => typeof code === "string" && code.length > 0 && code.length <= 32)
    || (shortcut !== "loading" && shortcut !== "registered" && shortcut !== "unavailable")) {
    throw new Error("Invalid controls");
  }
  const strings = codes as string[];
  const keys = Object.fromEntries(GAME_ACTIONS.map((action, index) => [action, strings[index]])) as Record<(typeof GAME_ACTIONS)[number], string>;
  return { controls: { keys, toggle: strings[GAME_ACTIONS.length] ?? "" }, shortcut };
}

export async function loadControls(): Promise<ControlsSnapshot> {
  if (!isTauri()) {
    throw new Error("TAURI_REQUIRED");
  }
  return parseControls(await invoke<unknown>("local_controls"));
}

export async function saveControls(controls: Controls): Promise<void> {
  if (!isTauri()) {
    throw new Error("TAURI_REQUIRED");
  }
  await invoke("local_set_controls", { keys: GAME_ACTIONS.map((action) => controls.keys[action]), toggle: controls.toggle });
}

export async function watchControls(onChange: (snapshot: ControlsSnapshot) => void, onError: (error: unknown) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에서는 네이티브 구독이 없어 정리할 자원이 없다. */ };
  }
  return listen<unknown>("local-controls-changed", ({ payload }) => {
    try {
      onChange(parseControls(payload));
    } catch (error) {
      onError(error);
    }
  });
}
