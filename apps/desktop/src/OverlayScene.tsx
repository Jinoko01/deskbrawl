import { useEffect, useRef, useState } from "react";
import { mountCharacter } from "./game/mountCharacter";
import { startLocalGame } from "./game/startLocalGame";
import { reportRendererFailure } from "./native/overlay";

export function OverlayScene() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (host.current === null) {
      return;
    }
    const element = host.current;
    let stopGame: (() => void) | undefined;
    const scene = mountCharacter(element, (next) => {
      setStatus(next);
      if (next === "ready") {
        stopGame = startLocalGame(element, scene, (error) => {
          console.error("로컬 게임 실행 실패", error);
          setStatus("error");
          stopGame?.();
          void reportRendererFailure().catch((failure: unknown) => console.error("렌더 오류 보고 실패", failure));
        });
      }
      if (next === "error") {
        stopGame?.();
      }
    });
    return () => {
      stopGame?.();
      scene.dispose();
    };
  }, []);

  return (
    <>
      <div ref={host} className="character-host" />
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
