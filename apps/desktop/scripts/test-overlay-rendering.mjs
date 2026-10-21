// Vite 개발 서버의 브라우저 콘솔에서 실행:
// await (await import('/scripts/test-overlay-rendering.mjs')).testOverlayRendering()
import { Application } from "pixi.js";
import { mountCharacter } from "../src/game/mountCharacter.ts";

export async function testOverlayRendering() {
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", width: "320px", height: "200px" });
  document.body.append(host);
  const originalInit = Application.prototype.init;
  const originalDestroy = Application.prototype.destroy;
  const originalDecode = Image.prototype.decode;
  const originalMatchMedia = window.matchMedia;
  const motion = new EventTarget();
  motion.matches = false;
  window.matchMedia = (query) => query === "(prefers-reduced-motion: reduce)"
    ? motion : originalMatchMedia.call(window, query);
  let destroyed = 0;
  let currentApp;
  let cleanup = () => {};
  const captureInit = async function (...args) {
    await originalInit.apply(this, args);
    currentApp = this;
  };
  Application.prototype.init = captureInit;
  Application.prototype.destroy = function (...args) {
    destroyed += 1;
    return originalDestroy.apply(this, args);
  };

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  async function until(predicate) {
    const deadline = performance.now() + 10_000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error("렌더링 검증 시간 초과");
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  }

  async function mount(expected) {
    let status = "loading";
    cleanup = mountCharacter(host, (value) => { status = value; });
    await until(() => status !== "loading");
    check(status === expected, `예상 상태 ${expected}, 실제 상태 ${status}`);
  }

  try {
    for (let index = 0; index < 3; index += 1) {
      await mount("ready");
      check(host.querySelectorAll("canvas").length === 1, "중복 canvas");
      const canvas = host.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      check(gl.getContextAttributes().alpha, "알파 채널 비활성");
      check(gl.getParameter(gl.COLOR_CLEAR_VALUE)[3] === 0, "배경 알파가 0이 아님");
      check(currentApp.ticker.started === !document.hidden, "문서 가시성과 대기 루프 상태 불일치");
      if (!document.hidden) {
        const now = performance.now();
        for (let step = 1; step <= 4; step += 1) currentApp.ticker.update(now + step * 100);
        check(currentApp.stage.children[0].currentFrame > 0, "대기 프레임이 진행되지 않음");
      }
      motion.matches = true;
      motion.dispatchEvent(new Event("change"));
      check(!currentApp.ticker.started && currentApp.stage.children[0].currentFrame === 0,
        "동작 줄이기에서 대기 애니메이션이 정지하지 않음");
      const { pixels, width, height } = currentApp.renderer.extract.pixels({
        target: currentApp.stage,
        frame: currentApp.screen,
      });
      let visible = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] > 0) visible += 1;
      }
      check(pixels[3] === 0 && pixels[pixels.length - 1] === 0, "모서리가 불투명");
      check(visible > 100 && visible < width * height / 4, "캐릭터 누락 또는 불투명 배경");
      host.style.width = "180px";
      host.style.height = "120px";
      await until(() => canvas.width === Math.round(180 * devicePixelRatio)
        && canvas.height === Math.round(120 * devicePixelRatio));
      cleanup();
      check(host.childElementCount === 0, "해제 후 canvas 잔류");
      host.style.width = "320px";
      host.style.height = "200px";
      motion.matches = false;
    }

    let releaseInit;
    let initReady = false;
    const gate = new Promise((resolve) => { releaseInit = resolve; });
    Application.prototype.init = async function (...args) {
      await originalInit.apply(this, args);
      initReady = true;
      await gate;
    };
    cleanup = mountCharacter(host, () => {});
    try {
      await until(() => initReady);
      cleanup();
    } finally {
      releaseInit();
    }
    await until(() => destroyed === 4);
    check(host.childElementCount === 0, "초기화 취소 후 canvas 잔류");
    Application.prototype.init = originalInit;

    Image.prototype.decode = async () => { throw new Error("테스트용 이미지 로딩 실패"); };
    await mount("error");
    check(host.childElementCount === 0 && destroyed === 5, "실패 후 자원 잔류");
    Image.prototype.decode = originalDecode;
    window.matchMedia = originalMatchMedia;
    Application.prototype.init = captureInit;
    let contextStatus = "loading";
    cleanup = mountCharacter(host, (value) => { contextStatus = value; });
    await until(() => contextStatus !== "loading");
    check(contextStatus === "ready", "context 손실 검사 준비 실패");
    const canvas = host.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const loseContext = gl.getExtension("WEBGL_lose_context");
    check(loseContext !== null, "context 손실 검사 미지원 환경");
    loseContext.loseContext();
    await until(() => contextStatus === "error");
    check(host.childElementCount === 0 && destroyed === 6, "context 손실 후 자원 잔류");
    console.log("PASS: 투명 픽셀, resize/DPR, 반복 mount, 초기화 취소, 로딩 실패, context 손실 정리");
  } finally {
    cleanup();
    Application.prototype.init = originalInit;
    Application.prototype.destroy = originalDestroy;
    Image.prototype.decode = originalDecode;
    window.matchMedia = originalMatchMedia;
    host.remove();
  }
}
