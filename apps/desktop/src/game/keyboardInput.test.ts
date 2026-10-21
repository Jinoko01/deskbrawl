import { expect, test } from "vitest";
import { createKeyboardInput } from "./keyboardInput";

test("방향키를 합성하고 반대 방향을 상쇄하며 해제한다", () => {
  const input = createKeyboardInput();
  input.press("ArrowRight", false);
  input.press("ArrowUp", false);
  expect(input.movement()).toEqual({ x: 1, y: -1 });
  input.press("ArrowLeft", false);
  expect(input.movement()).toEqual({ x: 0, y: -1 });
  input.release("ArrowRight");
  expect(input.movement()).toEqual({ x: -1, y: -1 });
  input.clear();
  expect(input.movement()).toEqual({ x: 0, y: 0 });
});

test("Z/X는 한 번 누를 때만 행동을 만들고 반복 입력과 다른 키를 무시한다", () => {
  const input = createKeyboardInput();
  expect(input.press("KeyZ", false).action).toBe("melee");
  expect(input.press("KeyZ", true).changed).toBe(false);
  expect(input.press("KeyZ", false).changed).toBe(false);
  expect(input.release("KeyZ")).toBe(true);
  expect(input.press("KeyZ", false).action).toBe("melee");
  expect(input.press("KeyX", false).action).toBe("stone");
  expect(input.press("KeyA", false).handled).toBe(false);
});

test("수정키와 함께 누른 키는 앱 단축키로 남기고 게임 입력으로 쓰지 않는다", () => {
  const input = createKeyboardInput();
  expect(input.press("KeyZ", false, true)).toEqual({ handled: false, changed: false });
  expect(input.press("ArrowRight", false, true).handled).toBe(false);
  expect(input.movement()).toEqual({ x: 0, y: 0 });
});

test("바꾼 조작키로 입력하고 변경 시 눌린 키를 비운다", () => {
  const input = createKeyboardInput();
  input.press("ArrowRight", false);
  input.setKeys({
    up: "KeyW",
    left: "KeyA",
    down: "KeyS",
    right: "KeyD",
    melee: "KeyJ",
    stone: "KeyK",
  });
  expect(input.movement()).toEqual({ x: 0, y: 0 });
  expect(input.press("ArrowRight", false).handled).toBe(false);
  expect(input.press("KeyZ", false).handled).toBe(false);
  input.press("KeyD", false);
  input.press("KeyW", false);
  expect(input.movement()).toEqual({ x: 1, y: -1 });
  expect(input.press("KeyJ", false).action).toBe("melee");
  expect(input.press("KeyK", false).action).toBe("stone");
});
