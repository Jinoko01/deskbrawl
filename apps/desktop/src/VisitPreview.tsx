import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@deskbrawl/protocol";
import { mountCharacter } from "./game/mountCharacter";
import { createSnapshotView } from "./game/networkScene";

export function VisitPreview({ subscribe }: { subscribe: (listener: (snapshot: Snapshot) => void) => () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    if (host.current === null) return;
    host.current.scrollIntoView({ block: "center" });
    const scene = mountCharacter(host.current, setStatus, "preview");
    const buffer = createSnapshotView(scene.update);
    const stop = subscribe(buffer.receive);
    return () => { stop(); buffer.dispose(); scene.dispose(); };
  }, [subscribe]);
  return <div className="mt-4 rounded-xl border border-border bg-background p-2">
    <div ref={host} className="h-52 w-full" aria-label="방문 공간 미리보기" />
    {status !== "ready" && <p role="status" className="text-sm">{status === "loading" ? "미리보기를 불러오는 중…" : "미리보기를 표시하지 못했습니다. 귀환 후 다시 방문해 주세요."}</p>}
  </div>;
}
