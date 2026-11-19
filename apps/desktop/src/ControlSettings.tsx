import { useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ACTION_LABELS,
  DEFAULT_CONTROLS,
  GAME_ACTIONS,
  controlsProblem,
  isModifierCode,
  keyLabel,
  sameControls,
  shortcutFromEvent,
  shortcutLabel,
} from "./game/keyMap";
import type { Controls, GameAction } from "./game/keyMap";

type ControlTarget = GameAction | "toggle";

interface ControlSettingsProps {
  readonly controls: Controls;
  // PLAY 중에는 키를 받지 않아 설정 입력이 게임 입력과 섞이지 않는다.
  readonly disabled: boolean;
  readonly onSave: (next: Controls) => Promise<void>;
}

const buttonClass = "button button-secondary";

export function ControlSettings({ controls, disabled, onSave }: ControlSettingsProps) {
  const [draft, setDraft] = useState(controls);
  const [recording, setRecording] = useState<ControlTarget>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState(false);
  const locked = disabled || saving;
  const problem = controlsProblem(draft);
  const changed = !sameControls(draft, controls);
  const listening = locked ? undefined : recording;

  function edit(next: Controls): void {
    setDraft(next);
    setFailure(undefined);
    setSaved(false);
  }

  function record(target: ControlTarget, event: KeyboardEvent<HTMLButtonElement>): void {
    if (listening !== target) {
      return;
    }
    // Tab은 포커스 이동에 남겨 둔다.
    if (event.code === "Tab") {
      setRecording(undefined);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || isModifierCode(event.code)) {
      return;
    }
    setRecording(undefined);
    if (event.code === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      return;
    }
    edit(target === "toggle"
      ? { ...draft, toggle: shortcutFromEvent(event) }
      : { ...draft, keys: { ...draft.keys, [target]: event.code } });
  }

  async function save(): Promise<void> {
    setSaving(true);
    setFailure(undefined);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function renderControlRow(target: ControlTarget, label: string, value: string) {
    const active = listening === target;
    return (
      <li key={target} className="control-row">
        <span className="text-sm text-foreground">{label}</span>
        <button
          type="button"
          disabled={locked}
          aria-pressed={active}
          aria-label={active ? `${label}: 새 키를 누르세요. Esc로 취소` : `${label}: ${value}. 눌러서 변경`}
          onClick={() => setRecording(active ? undefined : target)}
          onKeyDown={(event) => record(target, event)}
          onBlur={() => {
            if (active) {
              setRecording(undefined);
            }
          }}
          className={`${buttonClass} key-binding ${active ? "recording" : ""}`}
        >
          {active ? "키를 누르세요…" : value}
        </button>
      </li>
    );
  }

  return (
    <section
      id="control-settings-title"
      aria-labelledby="page-title"
      className="panel settings-panel"
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        {disabled ? "Esc를 눌러 작업 모드로 돌아오면 조작키를 바꿀 수 있어요." : "바꿀 조작의 버튼을 누른 뒤 새 키를 눌러 주세요. Esc는 플레이 종료에 사용해요."}
      </p>
      <ul className="binding-list">
        {GAME_ACTIONS.map((action) => renderControlRow(action, ACTION_LABELS[action], keyLabel(draft.keys[action])))}
        {renderControlRow("toggle", "플레이 전환 단축키", shortcutLabel(draft.toggle))}
      </ul>
      {problem !== undefined && <p className="notice notice-error" aria-live="polite">{problem}</p>}
      {failure !== undefined && <p className="notice notice-error" role="alert">{failure}</p>}
      {saved && !changed && <p className="mt-3 text-sm text-muted-foreground" role="status">저장했어요. 다음 실행에도 유지돼요.</p>}
      <div className="settings-actions">
        <button
          type="button"
          disabled={locked || sameControls(draft, DEFAULT_CONTROLS)}
          onClick={() => edit(DEFAULT_CONTROLS)}
          className="button button-secondary"
        >
          기본값으로
        </button>
        <button
          type="button"
          disabled={locked || !changed}
          onClick={() => edit(controls)}
          className="button button-secondary"
        >
          변경 취소
        </button>
        <button
          type="button"
          disabled={locked || !changed || problem !== undefined}
          onClick={() => void save()}
          className="button button-primary"
        >
          {saving ? "저장하는 중…" : "저장"}
        </button>
      </div>
    </section>
  );
}
