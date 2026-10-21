import { useLocalControls } from "./game/useLocalControls";

export function App() {
  const { region, ready, playing, busy, error, supported, start, work } = useLocalControls();
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
            {playing ? "PLAY · 모찌를 조작 중" : ready ? "WORK · 플레이할 수 있음" : "WORK · 오버레이 준비 중"}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-foreground">
            방향키 이동 · Z 근접 공격 · X 돌 던지기
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Esc를 누르면 작업 모드로 돌아갑니다.</p>
          <button type="button" onClick={playing ? work : start}
            disabled={!playing && (!ready || busy || !supported)}
            className="mt-5 w-full rounded-lg border border-border bg-foreground px-4 py-2.5 font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "시작하는 중…" : playing ? "작업 모드로 돌아가기" : "플레이 시작"}
          </button>
        </div>
        {!supported && <p className="mt-4 text-sm text-muted-foreground">데스크톱 앱에서 플레이할 수 있습니다.</p>}
        {error && <p className="mt-4 text-sm text-foreground" role="alert">{error}</p>}
      </div>
    </main>
  );
}
