// 키 값은 키보드 배열과 무관한 KeyboardEvent.code다. 허용 범위는 Rust controls.rs와 같다.
export const GAME_ACTIONS = ["up", "left", "down", "right", "melee", "stone"] as const;
export type GameAction = (typeof GAME_ACTIONS)[number];
export type GameKeys = Readonly<Record<GameAction, string>>;

export interface Controls {
  readonly keys: GameKeys;
  // "Ctrl+Shift+KeyG"처럼 Ctrl·Alt·Shift 순서의 수정키와 code를 +로 잇는다.
  readonly toggle: string;
}

export const DEFAULT_CONTROLS: Controls = {
  keys: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight", melee: "KeyZ", stone: "KeyX" },
  toggle: "Ctrl+Shift+KeyG",
};

export const ACTION_LABELS: Readonly<Record<GameAction, string>> = {
  up: "위로 이동", left: "왼쪽 이동", down: "아래로 이동", right: "오른쪽 이동", melee: "근접 공격", stone: "돌 던지기",
};

const GAME_KEY = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space)$/;
const SHORTCUT = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2]))$/;
const ARROWS: Readonly<Record<string, string>> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

// 앞 글자의 받침에 따라 "과"/"와"를 고른다.
function and(word: string): string {
  const last = word.charCodeAt(word.length - 1) - 0xac00;
  return `${word}${last >= 0 && last < 11172 && last % 28 !== 0 ? "과" : "와"}`;
}

export function isGameKey(code: string): boolean { return GAME_KEY.test(code); }

export function isShortcut(value: string): boolean {
  const match = SHORTCUT.exec(value);
  if (match === null) return false;
  const modifiers = [match[1], match[2], match[3]].filter(Boolean).length;
  return modifiers >= 2 && (match[1] !== undefined || match[2] !== undefined);
}

export function isModifierCode(code: string): boolean { return MODIFIER_CODES.test(code); }

export function keyLabel(code: string): string {
  return ARROWS[code] ?? code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num ");
}

export function shortcutLabel(toggle: string): string {
  return toggle.split("+").map(keyLabel).join("+");
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey">): string {
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.code].filter(Boolean).join("+");
}

export function sameControls(a: Controls, b: Controls): boolean {
  return a.toggle === b.toggle && GAME_ACTIONS.every((action) => a.keys[action] === b.keys[action]);
}

// 저장 전에 사용자에게 보여줄 첫 문제다. 최종 검증은 Rust가 다시 수행한다.
export function controlsProblem(controls: Controls): string | undefined {
  for (const [index, action] of GAME_ACTIONS.entries()) {
    const code = controls.keys[action];
    if (code === "Escape") return `${ACTION_LABELS[action]}: Esc는 플레이 종료 키라서 쓸 수 없습니다.`;
    if (!isGameKey(code)) return `${ACTION_LABELS[action]}: ${keyLabel(code)} 키는 쓸 수 없습니다. 문자·숫자·숫자 패드·방향키·Space 중에서 고르세요.`;
    const other = GAME_ACTIONS.slice(0, index).find((previous) => controls.keys[previous] === code);
    if (other !== undefined) return `${and(ACTION_LABELS[other])} ${ACTION_LABELS[action]}에 같은 키(${keyLabel(code)})를 쓸 수 없습니다.`;
  }
  if (!isShortcut(controls.toggle)) {
    return `전환 단축키 ${shortcutLabel(controls.toggle)}는 쓸 수 없습니다. Ctrl 또는 Alt를 포함한 수정키 두 개 이상과 문자·숫자·F1~F12 키를 함께 누르세요.`;
  }
  return undefined;
}

export function controlsErrorMessage(code: string): string {
  switch (code) {
    case "SHORTCUT_IN_USE": return "다른 앱이 이미 쓰는 단축키입니다. 다른 조합을 고르세요.";
    case "DUPLICATE_KEY": return "같은 키를 두 동작에 쓸 수 없습니다.";
    case "INVALID_KEY": case "INVALID_SHORTCUT": case "INVALID_CONTROLS": return "쓸 수 없는 키가 있습니다.";
    case "PLAYING": return "플레이 중에는 조작키를 바꿀 수 없습니다. Esc로 작업 모드에 돌아온 뒤 저장하세요.";
    case "CONTROLS_LOADING": return "조작키 설정을 아직 불러오는 중입니다. 잠시 후 다시 저장하세요.";
    case "SAVE_FAILED": return "설정 파일을 저장하지 못했습니다. 이전 조작키를 유지합니다.";
    default: return `조작키 저장 실패: ${code}`;
  }
}
