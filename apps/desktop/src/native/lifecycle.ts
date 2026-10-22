import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function watchClosing(onClose: () => void): Promise<() => void> {
  return isTauri() ? listen("app-closing", onClose) : () => { /* Optional outside the desktop session. */ };
}

export async function finishExit(): Promise<void> {
  if (isTauri()) {
    await invoke("app_exit");
  }
}
