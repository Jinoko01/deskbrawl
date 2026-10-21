import { useEffect, useRef, useState } from "react";
import { mountCharacter } from "./game/mountCharacter";

export function OverlayScene() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (host.current === null) return;
    const scene = mountCharacter(host.current, setStatus);
    return scene.dispose;
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
