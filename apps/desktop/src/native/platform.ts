import { isTauri } from "@tauri-apps/api/core";

export function isMacDesktop(): boolean {
  return isTauri() && navigator.userAgent.includes("Macintosh");
}
