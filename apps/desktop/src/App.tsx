import { useEffect, useEffectEvent, useState } from "react";
import { ControlSettings } from "./ControlSettings";
import { DEFAULT_CONTROLS, keyLabel, shortcutLabel } from "./game/keyMap";
import { useLocalControls } from "./game/useLocalControls";
import { useMultiplayer } from "./hooks/queries/useMultiplayer";
import { MultiplayerPanel } from "./MultiplayerPanel";
import { closeApp } from "./native/overlay";
import { finishExit, watchClosing } from "./native/lifecycle";
import { CHARACTERS } from "./game/characters";
import { AppIcon } from "./AppIcon";

export function App() {
  const [page, setPage] = useState<"home" | "settings">("home");
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string>();
  async function exit(): Promise<void> {
    if (exiting) {
      return;
    }
    setExiting(true);
    setExitError(undefined);
    try {
      await closeApp();
    } catch {
      setExiting(false);
      setExitError("앱을 종료하지 못했습니다. 창의 X 버튼이나 트레이의 종료를 다시 눌러 주세요.");
    }
  }
  const multiplayer = useMultiplayer();
  const leaving = useEffectEvent(() => {
    void multiplayer.disconnect().catch(() => {
      // Native exit still completes when the server is unreachable.
    }).finally(() => {
      void finishExit();
    });
  });
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    void watchClosing(leaving).then((unlisten) => {
      if (active) {
        stop = unlisten;
      } else {
        unlisten();
      }
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
  const {
    region,
    ready,
    playing,
    busy,
    error,
    supported,
    controls,
    controlsError,
    save,
  } = useLocalControls(multiplayer.input);
  // Rust가 저장된 설정을 읽기 전에는 기본값을 실제 설정처럼 보여주지 않는다.
  const loaded = controls === undefined || controls.shortcut === "loading" ? undefined : controls;
  const shown = loaded?.controls ?? (supported ? undefined : DEFAULT_CONTROLS);
  const keys = shown?.keys;
  const shortcut = shown === undefined ? "전환 단축키" : shortcutLabel(shown.toggle);
  let playStatus = "WORK · 오버레이 준비 중";
  if (multiplayer.focused) {
    playStatus = "FOCUS · 캐릭터 숨김 · 방문 차단";
  } else if (playing) {
    const character = CHARACTERS[multiplayer.skin].name;
    playStatus = `PLAY · ${character}를 조작 중`;
  } else if (busy) {
    playStatus = "PLAY 시작하는 중…";
  } else if (ready) {
    playStatus = "WORK · 플레이할 수 있음";
  }
  let mode = "WORK";
  if (multiplayer.focused) {
    mode = "FOCUS";
  } else if (playing) {
    mode = "PLAY";
  }
  const connectionBusy = !multiplayer.focusLoaded || ["connecting", "reconnecting"].includes(multiplayer.view.phase)
    || multiplayer.connect.isPending || multiplayer.join.isPending || multiplayer.returning.isPending;
  const focusLabel = `집중 모드 ${multiplayer.focused ? "끄기" : "켜기"}`;
  return (
    <div className="app-shell">
      <aside className="app-rail">
        <a
          href="#main-content"
          className="brand-mark"
          aria-label="DeskBrawl 본문으로 이동"
        >
          <span aria-hidden="true">d.</span>
        </a>
        <nav aria-label="주 메뉴" className="rail-nav">
          <button
            type="button"
            className="rail-button"
            aria-current={page === "home" ? "page" : undefined}
            onClick={() => setPage("home")}
          >
            <AppIcon name="home" className="h-5 w-5" />
            <span>내 공간</span>
          </button>
          <button
            type="button"
            className="rail-button"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => setPage("settings")}
          >
            <AppIcon name="controls" className="h-5 w-5" />
            <span>조작 설정</span>
          </button>
        </nav>
        <span className="rail-footnote" aria-hidden="true">
          잠깐의
          <br />
          즐거움.
        </span>
      </aside>
      <div className="app-workspace">
        <header className="app-header">
          <div className="flex items-baseline gap-2.5">
            <span className="wordmark">
              DeskBrawl
              <span className="text-accent">.</span>
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">작은 친구들과 함께</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="mode-badge" data-mode={mode}>
              <span className="status-dot" />
              {mode}
            </span>
            {supported && (
              <button
                type="button"
                disabled={exiting}
                onClick={() => {
                  void exit();
                }}
                className="button button-quiet"
              >
                <AppIcon name="exit" />
                {exiting ? "종료 중…" : "종료"}
              </button>
            )}
          </div>
        </header>
        <main
          id="main-content"
          className="app-content"
          tabIndex={-1}
        >
          <div className="page-heading">
            <p className="eyebrow">{page === "home" ? "나의 데스크톱" : "나에게 맞는 플레이"}</p>
            <h1>{page === "home" ? "일상에 작은 플레이를." : "손에 익은 키로, 편하게."}</h1>
            <p className="text-sm text-muted-foreground">{page === "home" ? "내 캐릭터를 고르고, 친구와 잠깐 쉬어 가세요." : "조작키와 모드 전환 단축키를 바꿀 수 있어요."}</p>
          </div>
          {exitError && <p className="notice notice-error" role="alert">{exitError}</p>}
          <div
            ref={region}
            tabIndex={playing ? 0 : -1}
            role="group"
            aria-label="게임 조작 영역"
            className="mode-panel"
            data-focused={multiplayer.focused}
          >
            <div className="mode-panel-copy">
              <span className="mode-symbol" aria-hidden="true"><AppIcon name={multiplayer.focused ? "moon" : "controls"} className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-semibold" role="status">{playStatus}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {multiplayer.focused ? "캐릭터와 방문을 잠시 쉬어요. 해제하면 이전 방으로 돌아갑니다." : "작업할 때는 클릭이 통과하고, PLAY에서는 캐릭터를 조작해요."}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="button focus-button"
              aria-pressed={multiplayer.focused}
              disabled={connectionBusy || multiplayer.focus.isPending}
              onClick={() => multiplayer.focus.mutate(!multiplayer.focused)}
            >
              <span className="switch-track" aria-hidden="true"><span /></span>
              {multiplayer.focus.isPending ? "집중 모드 전환 중…" : focusLabel}
            </button>
          </div>
          {loaded?.shortcut === "unavailable" && (
            <p className="notice notice-error" role="alert">
              {`${shortcut} 단축키를 등록하지 못했습니다. 조작 설정에서 다른 단축키를 지정하거나 트레이의 ‘플레이 시작’을 사용하세요.`}
            </p>
          )}
          {loaded === undefined && supported && controlsError === undefined && <p className="notice" role="status">조작키 설정을 불러오는 중…</p>}
          {!supported && <p className="notice">웹 미리보기입니다. 캐릭터 플레이는 데스크톱 앱에서 사용할 수 있어요.</p>}
          {controlsError && <p className="notice notice-error" role="alert">{controlsError}</p>}
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div hidden={page !== "home"}>
            <MultiplayerPanel game={multiplayer} playing={playing || busy} />
            <section className="quick-guide" aria-label="플레이 조작 안내">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <kbd>{shortcut}</kbd>
                <span>WORK / PLAY 전환</span>
                <span className="guide-divider" />
                <kbd>Esc</kbd>
                <span>작업으로 돌아오기</span>
              </div>
              <details className="controls-help">
                <summary>플레이 조작법</summary>
                <p>{keys === undefined ? "조작키를 불러오는 중…" : `${[keys.up, keys.left, keys.down, keys.right].map(keyLabel).join(" · ")} 이동 / ${keyLabel(keys.melee)} 근접 공격 / ${keyLabel(keys.stone)} 돌 던지기`}</p>
                <p>공간 연결 후 PLAY에서 / 채팅 · 입력 중 바로 공유 · Enter 이전 줄 · Esc 닫기</p>
              </details>
            </section>
          </div>
          <div hidden={page !== "settings"}>
            {loaded !== undefined && (
              <ControlSettings
                controls={loaded.controls}
                disabled={playing || busy}
                onSave={save}
              />
            )}
            {!supported && <p className="panel p-6 text-sm text-muted-foreground">데스크톱 앱에서 조작키를 설정할 수 있어요.</p>}
          </div>
          <footer className="app-footer">
            <span>작업과 놀이 사이, DeskBrawl.</span>
            <span className="flex items-center gap-1.5">
              <span className="status-dot" />
              {multiplayer.view.phase === "guest" ? "친구 공간 방문 중" : "나만의 작은 공간"}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
