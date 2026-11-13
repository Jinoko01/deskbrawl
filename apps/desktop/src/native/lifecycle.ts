import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function watchClosing(onClose: () => void): Promise<() => void> {
  return isTauri() ? listen("app-closing", onClose) : () => { /* Optional outside the desktop session. */ };
}

export async function watchExitConfirmation(onConfirm: () => void): Promise<() => void> {
  return isTauri() ? listen("app-confirm-exit", onConfirm) : () => { /* Desktop only. */ };
}

export async function requestExit(confirmed: boolean): Promise<void> {
  await invoke("app_request_exit", { confirmed });
}

export async function finishExit(): Promise<void> {
  if (isTauri()) {
    await invoke("app_exit");
  }
}
