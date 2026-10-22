import "./styles.css";
import { publishChatDraft, closeChat, watchChatOpened } from "./native/chat";
import { createChatEditor } from "./game/chatEditor";

function required<E extends HTMLElement>(selector: string): E {
  const element = document.querySelector<E>(selector);
  if (element === null) {
    throw new Error("Missing chat editor");
  }
  return element;
}
const input = required<HTMLInputElement>("#message");
const previous = required<HTMLElement>("#previous");
const status = required<HTMLElement>("#status");
let closed = false;
const editor = createChatEditor({
  publish: (current, line) => {
    previous.textContent = line;
    void publishChatDraft(current, line).catch(() => {
      if (!closed) {
        status.textContent = "채팅 연결이 끊겼어요. 닫고 다시 시도해 주세요.";
      }
    });
  },
  close: () => {
    if (closed) {
      return;
    }
    closed = true;
    input.value = "";
    previous.textContent = "";
    void closeChat().catch(() => { /* Native dismissal can precede this blur callback. */ });
  },
  fade: (faded) => document.body.classList.toggle("opacity-60", faded),
});
function opened(): void {
  closed = false;
  editor.open();
  input.value = "";
  previous.textContent = "";
  status.textContent = "Enter 이전 줄 · Esc 닫기 · 50자";
  input.focus();
}
input.addEventListener("input", () => editor.input(input.value));
input.addEventListener("compositionstart", () => editor.composition(true));
input.addEventListener("compositionend", () => {
  editor.composition(false);
  editor.input(input.value);
});
input.addEventListener("keydown", (event) => {
  if (editor.key(event.key, event.isComposing || event.keyCode === 229)) {
    event.preventDefault();
    input.value = "";
  }
});
document.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
window.addEventListener("blur", () => editor.close());
await watchChatOpened(opened);
// The first open can precede this WebView's script load.
opened();
