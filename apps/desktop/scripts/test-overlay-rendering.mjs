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
  let scene;
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
    scene = mountCharacter(host, (value) => { status = value; });
    cleanup = scene.dispose;
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
      check(currentApp.stage.children.length === 2, "두 캐릭터가 표시되지 않음");
      check(canvas.getAttribute("aria-label") === "모찌와 민트 캐릭터", "캐릭터 접근성 이름 누락");
      const [first, second] = currentApp.stage.children;
      const body = first.children[0];
      check(first.x < second.x && second.children[0].scale.x < 0, "두 캐릭터 위치·방향 오류");
      check(body.texture.source !== second.children[0].texture.source, "서로 다른 캐릭터 atlas 누락");
      // Tauri 설정 조회는 비동기다. ready 이후 실제 환경 설정이 반영될 때까지 기다린다.
      await until(() => currentApp.ticker.started === !document.hidden);
      if (!document.hidden) {
        const now = performance.now();
        for (let step = 1; step <= 4; step += 1) currentApp.ticker.update(now + step * 100);
        check(body.currentFrame > 0, "대기 프레임이 진행되지 않음");
      }
      motion.matches = true;
      motion.dispatchEvent(new Event("change"));
      check(!currentApp.ticker.started && body.currentFrame === 0,
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
      let leftVisible = 0;
      let rightVisible = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4 + 3] > 0) {
            if (x < width / 2) leftVisible++; else rightVisible++;
          }
        }
      }
      check(leftVisible > 100 && rightVisible > 100, "한쪽 캐릭터의 실제 픽셀 누락");

      if (index === 0) {
        const snapshot = { bounds: { width: 320, height: 200 }, characters: [
          { id: "host", skin: "mochi", position: { x: 80, y: 110 }, facing: { x: -1, y: 0 }, motion: { kind: "walk" } },
          { id: "guest", skin: "mint", position: { x: 230, y: 110 }, facing: { x: 1, y: 0 }, motion: { kind: "stun" } },
        ] };
        scene.update(snapshot);
        check(first.x === 80 && body.scale.x < 0, "효과 감소 중 위치·방향 갱신 실패");
        check(second.children[1].visible && !currentApp.ticker.started, "효과 감소 중 기절 상태 표현 실패");
        check(second.children[0].currentFrame === 1, "기절 시 마지막 피격 자세 누락");
        snapshot.characters = snapshot.characters.map((frame) => ({ ...frame, motion: { kind: "melee", actionId: "one" } }));
        scene.update(snapshot);
        motion.matches = false;
        motion.dispatchEvent(new Event("change"));
        // Ticker의 최대 delta 제한을 포함하여 단발 모션의 종료를 기다린다.
        if (!document.hidden) await until(() => !currentApp.ticker.started);
        check(document.hidden || currentApp.stage.children.every((item) => !item.children[0].playing), "단발 모션이 종료되지 않음");
        scene.update({ ...snapshot });
        check(document.hidden || !currentApp.ticker.started, "동일 actionId가 중복 재생됨");
        scene.update({ ...snapshot, characters: snapshot.characters.slice(0, 1) });
        check(currentApp.stage.children.length === 1 && second.destroyed, "제거된 캐릭터 자원 잔류");
        scene.update({ ...snapshot, characters: snapshot.characters.map((frame) => ({ ...frame, skin: "mint", motion: { kind: "idle" } })) });
        check(currentApp.stage.children.length === 2, "캐릭터 변경 후 복구 실패");
      }
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
    cleanup = mountCharacter(host, () => {}).dispose;
    try {
      await until(() => initReady);
      cleanup();
    } finally {
      releaseInit();
    }
    await until(() => destroyed === 4);
    check(host.childElementCount === 0, "초기화 취소 후 canvas 잔류");
    Application.prototype.init = originalInit;

    let releaseDecode;
    let decoding = false;
    let statusDuringLoad = "loading";
    let partialDecodes = 0;
    const decodeGate = new Promise((resolve) => { releaseDecode = resolve; });
    Image.prototype.decode = async function () {
      await originalDecode.call(this);
      if (++partialDecodes === 2) { decoding = true; await decodeGate; }
    };
    scene = mountCharacter(host, (status) => { statusDuringLoad = status; });
    cleanup = scene.dispose;
    const beforeInvalidUpdate = destroyed;
    try {
      await until(() => decoding);
      scene.update({ bounds: { width: 0, height: 200 }, characters: [] });
      check(statusDuringLoad === "error", "로딩 중 비정상 상태를 거절하지 않음");
    } finally { releaseDecode(); }
    await until(() => destroyed === beforeInvalidUpdate + 1);
    check(host.childElementCount === 0 && statusDuringLoad === "error", "비동기 로딩 실패 후 장면이 다시 생성됨");
    cleanup();

    let decodeCount = 0;
    Image.prototype.decode = async function () {
      if (++decodeCount === 2) throw new Error("테스트용 두 번째 이미지 로딩 실패");
      return originalDecode.call(this);
    };
    const beforeFailure = destroyed;
    await mount("error");
    await until(() => destroyed === beforeFailure + 1);
    check(host.childElementCount === 0, "실패 후 자원 잔류");
    Image.prototype.decode = originalDecode;
    window.matchMedia = originalMatchMedia;
    Application.prototype.init = captureInit;
    const beforeContextLoss = destroyed;
    let contextStatus = "loading";
    cleanup = mountCharacter(host, (value) => { contextStatus = value; }).dispose;
    await until(() => contextStatus !== "loading");
    check(contextStatus === "ready", "context 손실 검사 준비 실패");
    const canvas = host.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const loseContext = gl.getExtension("WEBGL_lose_context");
    check(loseContext !== null, "context 손실 검사 미지원 환경");
    loseContext.loseContext();
    await until(() => contextStatus === "error");
    check(host.childElementCount === 0 && destroyed === beforeContextLoss + 1, "context 손실 후 자원 잔류");
    console.log("PASS: 두 캐릭터 픽셀·상태 모션·효과 감소·투명 배경·resize/DPR·재생 중복 방지·초기화 취소·실패 정리");
  } finally {
    cleanup();
    Application.prototype.init = originalInit;
    Application.prototype.destroy = originalDestroy;
    Image.prototype.decode = originalDecode;
    window.matchMedia = originalMatchMedia;
    host.remove();
  }
}
