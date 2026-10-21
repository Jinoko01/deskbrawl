import { useLocalControls } from "./game/useLocalControls";

export function App() {
  const { region, ready, playing, busy, error, supported } = useLocalControls();
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          DeskBrawl
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          작은 친구들이 찾아올 데스크톱.
        </p>
        <div ref={region} tabIndex={playing ? 0 : -1} role="group"
          aria-label="게임 조작 영역" className="mt-8 rounded-xl border border-border p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          <p className="text-sm text-muted-foreground" role="status">
            {playing ? "PLAY · 모찌를 조작 중" : busy ? "PLAY 시작하는 중…" : ready ? "WORK · 플레이할 수 있음" : "WORK · 오버레이 준비 중"}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-foreground">
            방향키 이동 · Z 근접 공격 · X 돌 던지기
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            어느 창에서든 Ctrl+Shift+G로 플레이·작업 모드를 전환합니다. Esc로도 작업 모드로 돌아갑니다.
          </p>
        </div>
        {!supported && <p className="mt-4 text-sm text-muted-foreground">데스크톱 앱에서 플레이할 수 있습니다.</p>}
        {error && <p className="mt-4 text-sm text-foreground" role="alert">{error}</p>}
      </div>
    </main>
  );
}
