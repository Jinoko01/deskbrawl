import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function watchChatRequest(onRequest: () => void): Promise<() => void> {
  return isTauri() ? listen("chat-request", onRequest) : () => { /* Optional outside the desktop session. */ };
}

export async function watchChat(onDraft: (current: string, previous: string) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* Optional outside the desktop session. */ };
  }
  return listen<unknown>("chat-draft", ({ payload }) => {
    if (Array.isArray(payload) && payload.length === 2 && payload.every((line) => typeof line === "string" && line.length <= 50)) {
      onDraft(payload[0] as string, payload[1] as string);
    }
  });
}

export async function openChat(position: { x: number; y: number }, bounds: { width: number; height: number }): Promise<void> {
  if (isTauri()) {
    await invoke("chat_open", { x: position.x / bounds.width, y: position.y / bounds.height });
  }
}

export function publishChatDraft(current: string, previous: string): Promise<void> {
  return invoke("chat_update", { current, previous });
}
export function closeChat(): Promise<void> {
  return invoke("chat_close");
}
export function watchChatOpened(onOpen: () => void): Promise<() => void> {
  return listen("chat-opened", onOpen);
}
