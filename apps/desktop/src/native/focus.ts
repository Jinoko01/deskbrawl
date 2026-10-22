import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function readFocus(): Promise<boolean> {
  const value: unknown = isTauri() ? await invoke("focus_read") : false;
  if (typeof value !== "boolean") {
    throw new Error("집중 모드 상태를 확인하지 못했습니다.");
  }
  return value;
}

export async function setNativeFocus(focused: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("focus_set", { focused });
  }
}

export async function watchFocus(onChange: (focused: boolean) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에는 네이티브 구독 자원이 없다. */ };
  }
  return listen<unknown>("focus-changed", ({ payload }) => {
    if (typeof payload === "boolean") {
      onChange(payload);
    }
  });
}

export async function publishInviteLink(link: string | null): Promise<void> {
  if (isTauri()) {
    await invoke("invite_publish", { link });
  }
}
