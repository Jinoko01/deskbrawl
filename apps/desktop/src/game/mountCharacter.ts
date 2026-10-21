import { Application, ImageSource, Sprite, Spritesheet, Texture } from "pixi.js";
// Tauri의 script-src 'self'를 유지하면서 eval 없는 shader 경로를 사용한다.
import "pixi.js/unsafe-eval";
import atlas from "../../../../packages/game-assets/characters/mochi-v2.json";
import imageUrl from "../../../../packages/game-assets/characters/mochi-v2.png";

// M0 표시 크기: atlas의 논리 프레임 높이를 96 CSS px로 축소한다.
const CHARACTER_SIZE_PX = 96;

export function mountCharacter(
  host: HTMLElement,
  onStatus: (status: "loading" | "ready" | "error") => void,
): () => void {
  const app = new Application();
  let disposed = false;
  let initialized = false;
  let sheet: Spritesheet | undefined;
  let observer: ResizeObserver | undefined;

  function release() {
    observer?.disconnect();
    window.removeEventListener("resize", draw);
    if (initialized) {
      app.canvas.removeEventListener("webglcontextlost", onContextLost);
      app.destroy(true, { children: true });
      initialized = false;
    }
    sheet?.destroy(true);
    sheet = undefined;
  }

  function fail(error: unknown) {
    release();
    if (!disposed) {
      console.error("오버레이 캐릭터 렌더링 실패", error);
      onStatus("error");
    }
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("WebGL context가 손실되었습니다."));
  }

  function draw() {
    if (!initialized || disposed) return;
    try {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      app.renderer.resize(width, height, window.devicePixelRatio || 1);
      const character = app.stage.children[0];
      if (character === undefined) return;
      const size = Math.min(CHARACTER_SIZE_PX, width, height);
      const frame = atlas.frames["mochi-0"];
      character.scale.set(size / frame.sourceSize.h);
      character.position.set(
        Math.round(width / 2),
        Math.round(height / 2 + size * (frame.anchor.y - 0.5)),
      );
      app.render();
    } catch (error) {
      fail(error);
    }
  }

  async function start() {
    onStatus("loading");
    try {
      await app.init({
        preference: "webgl",
        backgroundAlpha: 0,
        antialias: false,
        autoDensity: true,
        autoStart: false,
        sharedTicker: false,
        resolution: window.devicePixelRatio || 1,
      });
      initialized = true;
      if (disposed) return release();

      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      if (disposed) return release();

      // 이 장면만 소유한 texture를 사용해 공유 Assets 캐시와 수명을 섞지 않는다.
      sheet = new Spritesheet(
        new Texture({
          source: new ImageSource({ resource: image, scaleMode: "nearest" }),
        }),
        atlas,
      );
      await sheet.parse();
      if (disposed) return release();

      const texture = sheet.textures["mochi-0"];
      if (texture === undefined) throw new Error("모찌 대기 프레임이 없습니다.");
      const character = new Sprite(texture);
      character.anchor.copyFrom(atlas.frames["mochi-0"].anchor);
      character.roundPixels = true;
      app.stage.eventMode = "none";
      app.stage.addChild(character);
      app.canvas.setAttribute("role", "img");
      app.canvas.setAttribute("aria-label", "모찌 캐릭터");
      app.canvas.addEventListener("webglcontextlost", onContextLost);
      host.append(app.canvas);
      observer = new ResizeObserver(draw);
      observer.observe(host);
      window.addEventListener("resize", draw);
      draw();
      if (initialized) onStatus("ready");
    } catch (error) {
      fail(error);
    }
  }

  void start();
  return () => {
    disposed = true;
    // 진행 중인 비동기 초기화/atlas parse는 각 await 뒤에서 정리한다.
    // 여기서 초기화 중인 renderer나 texture를 파괴하지 않는다.
    if (observer !== undefined) release();
  };
}
