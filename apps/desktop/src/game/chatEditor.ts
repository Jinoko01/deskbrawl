interface ChatEditorSink {
  publish(current: string, previous: string): void;
  close(): void;
  fade(faded: boolean): void;
}

// Matches the observed Figma two-line draft behavior; OS composition stays in the input.
export function createChatEditor(sink: ChatEditorSink) {
  let current = "";
  let previous = "";
  let composing = false;
  let active = false;
  let fade: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function clearTimers(): void {
    clearTimeout(fade);
    clearTimeout(expiry);
  }
  function close(): void {
    if (!active) {
      return;
    }
    active = false;
    clearTimers();
    current = previous = "";
    sink.publish("", "");
    sink.close();
  }
  function touch(): void {
    clearTimers();
    sink.fade(false);
    fade = setTimeout(() => sink.fade(true), 5000);
    expiry = setTimeout(close, 8000);
  }
  return {
    open(): void {
      active = true;
      composing = false;
      current = previous = "";
      touch();
    },
    input(value: string): void {
      if (!active) {
        return;
      }
      current = value.slice(0, 50);
      sink.publish(current, previous);
      touch();
    },
    composition(value: boolean): void {
      composing = value;
    },
    key(key: string, isComposing = false): boolean {
      if (!active || composing || isComposing) {
        return false;
      }
      if (key === "Escape") {
        close();
        return true;
      }
      if (key !== "Enter") {
        return false;
      }
      if (current !== "") {
        previous = current;
      }
      current = "";
      sink.publish(current, previous);
      touch();
      return true;
    },
    close,
  };
}
