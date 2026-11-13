import {
  useEffect, useEffectEvent, useRef, useState,
} from "react";
import { ControlSettings } from "./ControlSettings";
import { DEFAULT_CONTROLS, keyLabel, shortcutLabel } from "./game/keyMap";
import { useLocalControls } from "./game/useLocalControls";
import { useMultiplayer } from "./hooks/queries/useMultiplayer";
import { MultiplayerPanel } from "./MultiplayerPanel";
import {
  finishExit, requestExit, watchClosing, watchExitConfirmation,
} from "./native/lifecycle";
import { startNativePlay } from "./native/localGame";
import { AppIcon } from "./AppIcon";

export function App() {
  const [page, setPage] = useState<"home" | "settings">("home");
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string>();
  const [playError, setPlayError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const exitDialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const multiplayer = useMultiplayer();
  const {
    ready, playing, busy, error, supported, controls, controlsError, save,
  } = useLocalControls(multiplayer.input);

  async function exit(confirmed: boolean): Promise<void> {
    setExitError(undefined);
    try {
      await requestExit(confirmed);
    } catch {
      setExitError("앱을 종료하지 못했어요. 종료 버튼을 다시 눌러 주세요.");
    }
  }

  async function startPlay(): Promise<void> {
    setStarting(true);
    setPlayError(undefined);
    try {
      await startNativePlay();
    } catch {
      setPlayError("플레이를 시작하지 못했어요. 캐릭터가 보이는지 확인하고 다시 시도해 주세요.");
    } finally {
      setStarting(false);
    }
  }

  function navigate(next: typeof page): void {
    if (next === page) {
      heading.current?.focus();
      return;
    }
    moveFocus.current = true;
    setPage(next);
  }

  const leaving = useEffectEvent(() => {
    setExiting(true);
    exitDialog.current?.close();
    void multiplayer.disconnect().finally(finishExit).catch((cause: unknown) => {
      console.error("종료 처리 실패", cause);
    });
  });
  useEffect(() => {
    let active = true;
    const stops: (() => void)[] = [];
    for (const registration of [
      watchClosing(leaving),
      watchExitConfirmation(() => {
        const dialog = exitDialog.current;
        if (active && dialog && !dialog.open) {
          dialog.showModal();
        }
      }),
    ]) {
      void registration.then((stop) => {
        if (active) {
          stops.push(stop);
        } else {
          stop();
        }
      }).catch((cause: unknown) => console.error("종료 이벤트 구독 실패", cause));
    }
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, []);
  useEffect(() => {
    document.title = page === "home" ? "DeskBrawl · 내 공간" : "DeskBrawl · 조작 설정";
    if (moveFocus.current) {
      heading.current?.focus();
      moveFocus.current = false;
    }
  }, [page]);

  const loaded = controls?.shortcut === "loading" ? undefined : controls;
  const shown = loaded?.controls ?? (supported ? undefined : DEFAULT_CONTROLS);
  const keys = shown?.keys;
  const shortcut = shown && shortcutLabel(shown.toggle);
  const connectionBusy = multiplayer.connectionBusy;
  const changingFocus = multiplayer.focus.isPending;
  const playPending = busy || starting;
  let mode = "작업 모드";
  let modeHelp = "캐릭터를 드래그해 옮길 수 있어요.";
  if (playing) {
    mode = "플레이 모드";
    modeHelp = "Esc를 누르면 작업 모드로 돌아가요.";
  } else if (multiplayer.focused) {
    mode = "집중 모드";
    modeHelp = "캐릭터와 방문을 쉬어요. 집중 모드를 끄면 플레이할 수 있어요.";
  } else if (changingFocus) {
    modeHelp = "집중 모드를 전환하고 있어요.";
  } else if (connectionBusy) {
    modeHelp = "연결 처리가 끝나면 플레이할 수 있어요.";
  } else if (!supported) {
    modeHelp = "데스크톱 앱에서 플레이할 수 있어요.";
  } else if (!loaded) {
    modeHelp = "조작키를 불러오면 플레이할 수 있어요.";
  } else if (!ready) {
    modeHelp = "캐릭터가 보이면 플레이할 수 있어요. 숨겼다면 트레이에서 표시해 주세요.";
  }
  const playDisabled = playing || playPending || !supported || !ready || !loaded || multiplayer.focused || changingFocus || connectionBusy;
  let playLabel = "플레이 시작";
  if (playPending) {
    playLabel = "플레이 시작 중…";
  } else if (playing) {
    playLabel = "플레이 중";
  }
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <aside className="app-rail">
        <button
          type="button"
          className="brand-mark"
          aria-label="DeskBrawl 홈"
          onClick={() => navigate("home")}
        >
          <img
            src="/brand/face.png"
            alt=""
            width="128"
            height="128"
            draggable={false}
          />
        </button>
        <nav aria-label="주 메뉴" className="rail-nav">
          <button
            type="button"
            className="rail-button"
            aria-current={page === "home" ? "page" : undefined}
            onClick={() => navigate("home")}
          >
            <AppIcon name="home" className="h-5 w-5" />
            <span>내 공간</span>
          </button>
          <button
            type="button"
            className="rail-button"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <AppIcon name="controls" className="h-5 w-5" />
            <span>조작 설정</span>
          </button>
        </nav>
      </aside>
      <div className="app-workspace">
        <header className="app-header">
          <span className="wordmark">
            DeskBrawl
            <span className="text-accent">.</span>
          </span>
          {supported && (
            <button
              type="button"
              disabled={exiting}
              onClick={() => void exit(false)}
              className="button button-quiet"
            >
              <AppIcon name="exit" />
              {exiting ? "종료 중…" : "종료"}
            </button>
          )}
        </header>
        <main
          id="main-content"
          className="app-content"
          tabIndex={-1}
        >
          <h1
            ref={heading}
            className="page-title"
            tabIndex={-1}
          >
            {page === "home" ? "내 공간" : "조작 설정"}
          </h1>
          {exitError && <p className="notice notice-error" role="alert">{exitError}</p>}
          <section className="mode-panel" aria-label="플레이와 집중 모드">
            <div className="min-w-0 flex-1">
              <p
                id="play-mode"
                className="text-sm font-semibold"
                role="status"
              >
                {mode}
              </p>
              <p id="play-help" className="mt-1 text-xs text-muted-foreground">{modeHelp}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="button button-primary"
                disabled={playDisabled}
                aria-describedby="play-help"
                onClick={() => void startPlay()}
              >
                <AppIcon name="controls" />
                {playLabel}
                {loaded?.shortcut === "registered" && !playing && <kbd>{shortcut}</kbd>}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={multiplayer.focused}
                aria-describedby="play-help"
                className="button button-secondary focus-button"
                disabled={connectionBusy || changingFocus}
                onClick={() => multiplayer.focus.mutate(!multiplayer.focused)}
              >
                <span className="switch-track" aria-hidden="true"><span /></span>
                집중 모드
              </button>
            </div>
          </section>
          {loaded?.shortcut === "unavailable" && (
            <p className="notice" role="status">{`${shortcut} 단축키를 등록하지 못했어요. 플레이 버튼을 쓰거나 조작 설정에서 단축키를 바꿔 주세요.`}</p>
          )}
          {controlsError && <p className="notice notice-error" role="alert">{controlsError}</p>}
          {(error ?? (!playing && playError)) && <p className="notice notice-error" role="alert">{error ?? playError}</p>}
          <div hidden={page !== "home"}>
            <MultiplayerPanel game={multiplayer} playing={playing || playPending} />
            <section className="quick-guide" aria-label="플레이 조작 안내">
              <h2 className="text-sm font-semibold text-foreground">플레이 조작법</h2>
              <p>{keys ? `${[keys.up, keys.left, keys.down, keys.right].map(keyLabel).join(" · ")} 이동 · ${keyLabel(keys.melee)} 근접 공격 · ${keyLabel(keys.stone)} 돌 던지기` : "조작키를 불러오는 중이에요."}</p>
              <p>
                공간에 연결하면
                <kbd>/</kbd>
                로 채팅할 수 있어요.
                <kbd>Esc</kbd>
                를 누르면 작업 모드로 돌아가요.
              </p>
            </section>
          </div>
          <div hidden={page !== "settings"}>
            {loaded && (
              <ControlSettings
                controls={loaded.controls}
                disabled={playing || playPending}
                onSave={save}
              />
            )}
            {!supported && <p className="notice">데스크톱 앱에서 조작키를 설정할 수 있어요.</p>}
          </div>
        </main>
      </div>
      <dialog
        ref={exitDialog}
        className="confirm-dialog"
        aria-labelledby="exit-title"
        aria-describedby="exit-detail"
      >
        <h2 id="exit-title" className="font-semibold">DeskBrawl을 종료할까요?</h2>
        <p id="exit-detail" className="mt-2 text-sm text-muted-foreground">앱을 종료하면 방문자의 연결도 끊겨요.</p>
        {exitError && <p className="notice notice-error" role="alert">{exitError}</p>}
        <form method="dialog" className="mt-5 flex justify-end gap-2">
          <button className="button button-secondary" autoFocus>취소</button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => void exit(true)}
          >
            종료
          </button>
        </form>
      </dialog>
    </div>
  );
}
