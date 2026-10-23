import { useEffect, useRef, useState } from "react";
import { mountCharacter } from "./game/mountCharacter";
import { startLocalGame } from "./game/startLocalGame";
import { reportRendererFailure, watchReducedEffects } from "./native/overlay";

export function OverlayScene() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(false);
  const [reducedEffects, setReducedEffects] = useState(true);

  useEffect(() => {
    if (host.current === null) {
      return;
    }
    const element = host.current;
    const stopEffects = watchReducedEffects(setReducedEffects, (error) => console.error("효과 설정 조회 실패", error));
    let stopGame: (() => void) | undefined;
    const scene = mountCharacter(element, (next) => {
      setStatus(next);
      if (next === "ready") {
        stopGame = startLocalGame(element, scene, (error) => {
          console.error("로컬 게임 실행 실패", error);
          setStatus("error");
          stopGame?.();
          void reportRendererFailure().catch((failure: unknown) => console.error("렌더 오류 보고 실패", failure));
        }, setPlaying);
      }
      if (next === "error") {
        setPlaying(false);
        stopGame?.();
      }
    });
    return () => {
      stopEffects();
      stopGame?.();
      scene.dispose();
    };
  }, []);

  return (
    <>
      <div ref={host} className="character-host" />
      <div
        className="play-glow"
        data-playing={playing && status === "ready"}
        data-reduced={reducedEffects}
        aria-hidden="true"
      />
      <p
        className="mode-badge"
        data-mode={playing ? "play" : "work"}
        role="status"
        aria-label="현재 모드"
      >
        <span aria-hidden="true" />
        {playing ? "PLAY" : "WORK · 드래그로 이동"}
      </p>
      {status !== "ready" && (
        <p className="overlay-status" role="status">
          {status === "loading"
            ? "캐릭터를 불러오는 중…"
            : "캐릭터를 표시하지 못했습니다. 앱을 다시 실행해 주세요."}
        </p>
      )}
    </>
  );
}
