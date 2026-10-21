import { expect, test } from "vitest";
import { parseControls } from "../native/controls";
import {
  DEFAULT_CONTROLS,
  controlsErrorMessage,
  controlsProblem,
  isShortcut,
  keyLabel,
  shortcutFromEvent,
  shortcutLabel,
} from "./keyMap";

test("기본 조작키는 유효하고 사람이 읽는 이름으로 표시된다", () => {
  expect(controlsProblem(DEFAULT_CONTROLS)).toBeUndefined();
  expect(["ArrowUp", "KeyZ", "Digit1", "Numpad8", "Space"].map(keyLabel)).toEqual(["↑", "Z", "1", "Num 8", "Space"]);
  expect(shortcutLabel("Ctrl+Shift+KeyG")).toBe("Ctrl+Shift+G");
});

test("같은 키를 두 동작에 쓰거나 Esc·허용되지 않은 키를 고르면 저장 전에 안내한다", () => {
  expect(controlsProblem({ ...DEFAULT_CONTROLS, keys: { ...DEFAULT_CONTROLS.keys, stone: "KeyZ" } }))
    .toBe("근접 공격과 돌 던지기에 같은 키(Z)를 쓸 수 없습니다.");
  expect(controlsProblem({ ...DEFAULT_CONTROLS, keys: { ...DEFAULT_CONTROLS.keys, left: "ArrowUp" } }))
    .toBe("위로 이동과 왼쪽 이동에 같은 키(↑)를 쓸 수 없습니다.");
  expect(controlsProblem({ ...DEFAULT_CONTROLS, keys: { ...DEFAULT_CONTROLS.keys, up: "Escape" } })).toContain("Esc는 플레이 종료 키");
  expect(controlsProblem({ ...DEFAULT_CONTROLS, keys: { ...DEFAULT_CONTROLS.keys, melee: "Enter" } })).toContain("Enter 키는 쓸 수 없습니다");
  expect(controlsProblem({
    keys: {
      up: "KeyW",
      left: "KeyA",
      down: "KeyS",
      right: "KeyD",
      melee: "KeyJ",
      stone: "KeyK",
    },
    toggle: "Ctrl+Alt+F9",
  }))
    .toBeUndefined();
});

test("전환 단축키는 Ctrl 또는 Alt를 포함한 수정키 두 개 이상이 필요하다", () => {
  for (const valid of ["Ctrl+Shift+KeyG", "Ctrl+Alt+Digit1", "Alt+Shift+F12", "Ctrl+Alt+Shift+KeyQ"]) {
    expect(isShortcut(valid)).toBe(true);
  }
  for (const invalid of ["Ctrl+KeyC", "Alt+F4", "Shift+KeyG", "KeyG", "Ctrl+Shift+Escape", "Shift+Ctrl+KeyG", "Ctrl+Shift+F13", "Ctrl+Shift+ArrowUp"]) {
    expect(isShortcut(invalid)).toBe(false);
  }
  expect(shortcutFromEvent({
    code: "KeyG",
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
  })).toBe("Ctrl+Shift+KeyG");
  expect(controlsProblem({ ...DEFAULT_CONTROLS, toggle: "Ctrl+KeyC" })).toContain("Ctrl+C는 쓸 수 없습니다");
});

test("Rust 오류 코드를 복구 방법이 있는 문장으로 바꾼다", () => {
  expect(controlsErrorMessage("SHORTCUT_IN_USE")).toContain("다른 앱");
  expect(controlsErrorMessage("PLAYING")).toContain("Esc");
  expect(controlsErrorMessage("UNKNOWN")).toBe("조작키 저장 실패: UNKNOWN");
});

test("IPC 조작키 응답은 7개의 키와 등록 상태만 받는다", () => {
  const codes = ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "KeyZ", "KeyX", "Ctrl+Shift+KeyG"];
  expect(parseControls([codes, "registered"])).toEqual({ controls: DEFAULT_CONTROLS, shortcut: "registered" });
  for (const invalid of [null, [codes], [codes.slice(1), "registered"], [codes, "ok"], [[...codes.slice(1), 1], "loading"], [[...codes.slice(1), ""], "loading"]]) {
    expect(() => parseControls(invalid)).toThrow("Invalid controls");
  }
});
