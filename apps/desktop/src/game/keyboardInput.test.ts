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
