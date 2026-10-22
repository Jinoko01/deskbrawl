import {
  afterEach, beforeEach, expect, it, vi,
} from "vitest";
import { createChatEditor } from "./chatEditor";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  const sink = { publish: vi.fn(), close: vi.fn(), fade: vi.fn() };
  const editor = createChatEditor(sink);
  editor.open();
  return { editor, sink };
}
it("shares drafts before Enter and keeps the previous line until Escape", () => {
  const { editor, sink } = setup();
  editor.input("안녕");
  expect(sink.publish).toHaveBeenLastCalledWith("안녕", "");
  expect(editor.key("Enter")).toBe(true);
  expect(sink.publish).toHaveBeenLastCalledWith("", "안녕");
  expect(sink.close).not.toHaveBeenCalled();
  editor.input("반가워");
  expect(sink.publish).toHaveBeenLastCalledWith("반가워", "안녕");
  editor.key("Escape");
  expect(sink.publish).toHaveBeenLastCalledWith("", "");
  expect(sink.close).toHaveBeenCalledOnce();
});
it("preserves Korean composition Enter and Escape and limits a line to 50 UTF-16 units", () => {
  const { editor, sink } = setup();
  editor.composition(true);
  editor.input("한글");
  expect(editor.key("Enter")).toBe(false);
  expect(editor.key("Escape")).toBe(false);
  expect(sink.close).not.toHaveBeenCalled();
  editor.composition(false);
  expect(editor.key("Enter", true)).toBe(false);
  editor.input("가".repeat(51));
  expect(sink.publish).toHaveBeenLastCalledWith("가".repeat(50), "");
});
it("resets the fade and close deadline on input and clears once on blur/unmount", () => {
  const { editor, sink } = setup();
  vi.advanceTimersByTime(4999);
  expect(sink.fade).not.toHaveBeenCalledWith(true);
  editor.input("live");
  vi.advanceTimersByTime(5000);
  expect(sink.fade).toHaveBeenLastCalledWith(true);
  expect(sink.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(3000);
  expect(sink.close).toHaveBeenCalledOnce();
  editor.close();
  vi.advanceTimersByTime(10000);
  expect(sink.close).toHaveBeenCalledOnce();
});
