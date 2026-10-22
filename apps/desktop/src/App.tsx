import { useEffect, useEffectEvent, useState } from "react";
import { ControlSettings } from "./ControlSettings";
import { DEFAULT_CONTROLS, keyLabel, shortcutLabel } from "./game/keyMap";
import { useLocalControls } from "./game/useLocalControls";
import { useMultiplayer } from "./hooks/queries/useMultiplayer";
import { MultiplayerPanel } from "./MultiplayerPanel";
import { closeApp } from "./native/overlay";
import { finishExit, watchClosing } from "./native/lifecycle";

export function App() {
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
    const character = multiplayer.view.phase === "guest" ? "민트" : "모찌";
    playStatus = `PLAY · ${character}를 조작 중`;
  } else if (busy) {
    playStatus = "PLAY 시작하는 중…";
  } else if (ready) {
    playStatus = "WORK · 플레이할 수 있음";
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            DeskBrawl
          </h1>
          {supported && (
            <button
              type="button"
              disabled={exiting}
              onClick={() => {
                void exit();
              }}
              className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm hover:bg-background active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-50"
            >
              {exiting ? "종료 중…" : "종료"}
            </button>
          )}
        </div>
        {exitError && <p className="mt-3 text-sm" role="alert">{exitError}</p>}
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          작은 친구들이 찾아올 데스크톱.
        </p>
        <div
          ref={region}
          tabIndex={playing ? 0 : -1}
          role="group"
          aria-label="게임 조작 영역"
          className="mt-8 rounded-xl border border-border p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          <p className="text-sm text-muted-foreground" role="status">
            {playStatus}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-foreground">
            {keys === undefined
              ? "조작키를 불러오는 중…"
              : `${[keys.up, keys.left, keys.down, keys.right].map(keyLabel).join(" ")} 이동 · ${keyLabel(keys.melee)} 근접 공격 · ${keyLabel(keys.stone)} 돌 던지기`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {`어느 창에서든 ${shortcut}로 플레이·작업 모드를 전환합니다. Esc로도 작업 모드로 돌아갑니다.`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">공간 연결 후 PLAY에서 / 채팅 · 입력 중 바로 공유 · Enter 이전 줄 · Esc 닫기</p>
        </div>
        {loaded?.shortcut === "unavailable" && (
          <p className="mt-4 text-sm text-foreground" role="alert">
            {`${shortcut} 단축키를 등록하지 못했습니다. 다른 앱이 쓰고 있을 수 있습니다. 아래에서 다른 단축키로 바꾸거나 트레이 메뉴의 ‘플레이 시작’을 사용하세요.`}
          </p>
        )}
        {loaded === undefined && supported && controlsError === undefined && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">조작키 설정을 불러오는 중…</p>
        )}
        {!supported && <p className="mt-4 text-sm text-muted-foreground">데스크톱 앱에서 플레이할 수 있습니다.</p>}
        {controlsError && <p className="mt-4 text-sm text-foreground" role="alert">{controlsError}</p>}
        {error && <p className="mt-4 text-sm text-foreground" role="alert">{error}</p>}
        <MultiplayerPanel game={multiplayer} playing={playing || busy} />
        {loaded !== undefined && (
          <ControlSettings
            controls={loaded.controls}
            disabled={playing || busy}
            onSave={save}
          />
        )}
      </div>
    </main>
  );
}
