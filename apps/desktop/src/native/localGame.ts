import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlayerAction, PlayerInput } from "@deskbrawl/game-core";

export interface LocalCommand {
  readonly kind: "play" | "input" | "work";
  readonly seq: number;
  readonly movement: PlayerInput["movement"];
  readonly action?: PlayerAction;
  // 이전 클라이언트의 WORK 명령과 호환하기 위한 선택 필드다.
  readonly restore?: true;
}

export function localGameSupported(): boolean {
  return isTauri();
}

export function parseLocalCommand(value: unknown): LocalCommand | "stop" {
  if (value === "stop") {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid local command");
  }
  const command = value as Record<string, unknown>;
  const movement = command.movement;
  if (!["play", "input", "work"].includes(String(command.kind)) || !Number.isSafeInteger(command.seq)
    || typeof command.seq !== "number" || command.seq <= 0 || typeof movement !== "object" || movement === null) {
    throw new Error("Invalid local command");
  }
  const axes = movement as Record<string, unknown>;
  if (![-1, 0, 1].includes(Number(axes.x)) || typeof axes.x !== "number"
    || ![-1, 0, 1].includes(Number(axes.y)) || typeof axes.y !== "number"
    || (command.action !== undefined && command.action !== "melee" && command.action !== "stone")) {
    throw new Error("Invalid local command");
  }
  // 위의 범위 검사 이후에만 내부 입력 타입으로 좁힌다.
  return value as LocalCommand;
}

export async function sendLocalCommand(command: LocalCommand): Promise<void> {
  if (!isTauri()) {
    throw new Error("TAURI_REQUIRED");
  }
  await invoke("local_control", { ...command });
}

export function localAvailable(): Promise<boolean> {
  return isTauri()
    ? invoke<unknown>("local_available").then((value) => {
        if (typeof value !== "boolean") {
          throw new Error("Invalid local status");
        }
        return value;
      })
    : Promise.resolve(false);
}

export async function reportLocalReady(ready: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("local_overlay_status", { ready });
  }
}

export async function watchLocalCommands(onCommand: (command: LocalCommand | "stop") => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에서는 네이티브 구독이 없어 정리할 자원이 없다. */ };
  }
  return listen<unknown>("local-input", ({ payload }) => {
    try {
      onCommand(parseLocalCommand(payload));
    } catch (error) {
      onCommand("stop");
      console.error("Invalid local input", error);
    }
  });
}

// 네이티브 단축키가 창 포커스를 유지하면서 PLAY 시작을 요청한다.
export async function watchLocalPlay(onPlay: () => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에서는 네이티브 구독이 없어 정리할 자원이 없다. */ };
  }
  return listen("local-play", () => onPlay());
}

export async function watchLocalKeys(onKey: (code: string, down: boolean) => void, onError: (error: unknown) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 네이티브 입력이 없는 브라우저에서는 구독하지 않는다. */ };
  }
  return listen<unknown>("local-key", ({ payload }) => {
    if (!Array.isArray(payload) || payload.length !== 2 || typeof payload[0] !== "string" || typeof payload[1] !== "boolean") {
      onError(new Error("Invalid native key"));
      return;
    }
    onKey(payload[0], payload[1]);
  });
}

export async function watchLocalReset(onReset: (ready: boolean) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => { /* 브라우저에서는 네이티브 구독이 없어 정리할 자원이 없다. */ };
  }
  return listen<unknown>("local-reset", ({ payload }) => {
    onReset(typeof payload === "boolean" && payload);
  });
}
