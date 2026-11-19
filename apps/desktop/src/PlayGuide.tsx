import { useLayoutEffect, useRef } from "react";
import type { CharacterSkin } from "@deskbrawl/protocol";
import { CharacterPortrait } from "./CharacterPicker";
import { AppIcon } from "./AppIcon";
import { ACTION_LABELS, keyLabel } from "./game/keyMap";
import type { GameKeys } from "./game/keyMap";
import type { useMultiplayer } from "./hooks/queries/useMultiplayer";

const movement = ["up", "left", "down", "right"] as const;
const guideTopics = {
  mode: { title: "플레이와 작업 전환", icon: "arrow" },
  keys: { title: "조작키", icon: "controls" },
  space: { title: "공간 연결", icon: "home" },
  visit: { title: "친구에게 놀러 가기", icon: "link" },
} as const;
export type GuideTopic = keyof typeof guideTopics;
type SpacePhase = ReturnType<typeof useMultiplayer>["view"]["phase"];

interface PlayKeysProps {
  readonly skin: CharacterSkin;
  readonly keys: GameKeys | undefined;
  readonly loading: boolean;
  readonly highlightKeys: boolean;
  readonly highlightWork: boolean;
}

function Keycap({ label, direction }: { readonly label: string | undefined; readonly direction?: string }) {
  if (!label) {
    return <span className="guide-key guide-key-loading" aria-hidden="true" />;
  }
  return (
    <kbd className="guide-key" data-long={label.length > 3 || undefined}>
      {direction && <span className="sr-only">{`${direction} `}</span>}
      {label}
    </kbd>
  );
}

export function PlayKeys({
  keys, skin, loading, highlightKeys, highlightWork,
}: PlayKeysProps) {
  return (
    <div className="play-keys">
      <dl className="play-key-layout" data-coach-target={highlightKeys || undefined}>
        <div className="play-key-group play-key-movement">
          <dt>이동</dt>
          <dd>
            <div className="arrow-keys">
              {movement.map((direction) => (
                <Keycap
                  key={direction}
                  label={keys && keyLabel(keys[direction])}
                  direction={ACTION_LABELS[direction]}
                />
              ))}
            </div>
          </dd>
        </div>
        <div className="play-key-group">
          <dt>{ACTION_LABELS.melee}</dt>
          <dd>
            <span className="key-pose" aria-hidden="true"><CharacterPortrait skin={skin} pose="melee" /></span>
            <Keycap label={keys && keyLabel(keys.melee)} />
          </dd>
        </div>
        <div className="play-key-group">
          <dt>{ACTION_LABELS.stone}</dt>
          <dd>
            <span className="key-pose" aria-hidden="true"><CharacterPortrait skin={skin} pose="throw" /></span>
            <Keycap label={keys && keyLabel(keys.stone)} />
          </dd>
        </div>
        <div className="play-key-group">
          <dt>연결 후 채팅</dt>
          <dd><Keycap label="/" /></dd>
        </div>
        <div className="play-key-group" data-coach-target={highlightWork || undefined}>
          <dt>작업 모드로</dt>
          <dd><Keycap label="Esc" /></dd>
        </div>
      </dl>
      {loading && <p className="mt-2 text-center text-xs text-muted-foreground" role="status">조작키를 불러오는 중이에요.</p>}
    </div>
  );
}

interface HelpTopicsProps {
  readonly onSelect: (topic: GuideTopic) => void;
}

export function HelpTopics({ onSelect }: HelpTopicsProps) {
  return (
    <nav
      id="help-topics"
      className="help-topics"
      popover="auto"
      aria-label="도움말 항목"
    >
      {(["mode", "keys", "space", "visit"] as const).map((topic) => (
        <button
          key={topic}
          type="button"
          className="help-topic"
          onClick={() => onSelect(topic)}
        >
          <AppIcon name={guideTopics[topic].icon} />
          {guideTopics[topic].title}
        </button>
      ))}
    </nav>
  );
}

function guideDescription(topic: Exclude<GuideTopic, "mode">, phase: SpacePhase): string {
  switch (topic) {
    case "keys": return "플레이 중 이 키로 이동하고 공격해요. 키는 조작 설정에서 바꿀 수 있어요.";
    case "space": {
      if (phase === "host") {
        return "방문 링크를 만들어 복사한 뒤 친구에게 보내면 내 공간에 초대할 수 있어요.";
      }
      if (phase === "guest") {
        return "내 공간으로 돌아간 뒤 방문 링크를 만들어 친구에게 보내세요.";
      }
      return "닉네임을 정하고 내 공간을 연결하세요. 연결되면 방문 링크를 만들어 친구에게 보낼 수 있어요.";
    }
    case "visit": return phase === "guest"
      ? "다른 친구에게 가려면 내 공간으로 돌아간 뒤 새 방문 링크를 붙여넣어요."
      : "친구에게 받은 방문 링크를 붙여넣고 방문하기를 누르면 친구 공간으로 이동해요.";
  }
}

interface DesktopCoachmarkProps {
  readonly topic: GuideTopic;
  readonly playing: boolean;
  readonly phase: SpacePhase;
  readonly onClose: (restoreFocus: boolean) => void;
}

export function DesktopCoachmark({
  topic, playing, phase, onClose,
}: DesktopCoachmarkProps) {
  const popover = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    function revealTarget(): void {
      document.querySelector("[data-coach-target]")?.scrollIntoView({ block: topic === "mode" ? "nearest" : "end" });
    }
    revealTarget();
    window.addEventListener("resize", revealTarget);
    const element = popover.current;
    if (element && !element.matches(":popover-open")) {
      element.showPopover();
      element.querySelector("button")?.focus({ preventScroll: true });
    }
    return () => window.removeEventListener("resize", revealTarget);
  }, [topic]);

  return (
    <section
      id="mode-coachmark"
      ref={popover}
      className="mode-coachmark"
      data-topic={topic}
      popover="auto"
      role="dialog"
      aria-labelledby="mode-coachmark-title"
      onToggle={(event) => {
        if (event.newState === "closed") {
          onClose(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (!playing) {
            event.preventDefault();
          }
          onClose(!playing);
        }
      }}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="mode-coachmark-title" className="text-base font-bold tracking-tight">{guideTopics[topic].title}</h2>
        <button
          type="button"
          className="coachmark-close"
          onClick={() => onClose(true)}
        >
          닫기
        </button>
      </header>
      {topic === "mode"
        ? (
            <dl className="coachmark-modes">
              <div>
                <dt>
                  <AppIcon name="controls" />
                  플레이 모드
                </dt>
                <dd>플레이 시작을 누르면 키보드로 캐릭터를 조작해요.</dd>
              </div>
              <div>
                <dt>
                  <kbd>Esc</kbd>
                  작업 모드
                </dt>
                <dd>작업 창으로 돌아가요. 캐릭터는 마우스로 끌어 옮겨요.</dd>
              </div>
            </dl>
          )
        : (
            <p className="mt-2 text-sm leading-relaxed">{guideDescription(topic, phase)}</p>
          )}
    </section>
  );
}
