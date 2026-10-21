import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OverlayScene } from "./OverlayScene";
import "./overlay.css";

const root = document.getElementById("overlay-root");
if (root === null) throw new Error("오버레이 루트 요소가 없습니다.");

createRoot(root).render(
  <StrictMode>
    <OverlayScene />
  </StrictMode>,
);
