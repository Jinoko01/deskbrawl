// Run using the Node version in package.json after pnpm build.
// Uses WebView2's local diagnostic port only for this owned test process.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// --dev는 Vite와 Tauri 개발 빌드가 준비된 경우에만 소스 기반 WebGL 검증도 실행한다.
const development = process.argv.includes("--dev");
const localGame = process.argv.includes("--local");
const executable = fileURLToPath(new URL(`../src-tauri/target/${development ? "debug" : "release"}/deskbrawl.exe`, import.meta.url));
const controller = fileURLToPath(new URL("./overlay-test-control.ps1", import.meta.url));
const profileRoot = resolve(fileURLToPath(new URL("../node_modules/.cache", import.meta.url)));
mkdirSync(profileRoot, { recursive: true });
const profile = mkdtempSync(join(profileRoot, "m0-webview-"));
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
await new Promise((resolve) => server.close(resolve));
const clients = [];
let app;
let originalPreference;
let overlay;

async function until(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

function control(action) {
  const output = execFileSync("pwsh", ["-NoProfile", "-File", controller,
    "-AppProcessId", String(app.pid), "-Action", action], { encoding: "utf8", windowsHide: true });
  return action === "state" ? JSON.parse(output) : undefined;
}

async function pages() {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
  catch { return []; }
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  function rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const current = ++id;
      const timer = setTimeout(() => { pending.delete(current); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      pending.set(current, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: current, method, params }));
    });
  }
  const client = {
    id: target.id,
    rpc,
    async evaluate(expression) {
      const result = await rpc("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() { socket.close(); },
  };
  clients.push(client);
  return client;
}

async function findOverlay(exclude) {
  let target;
  await until(async () => {
    target = (await pages()).find((page) => page.type === "page" && page.url.includes("overlay.html") && page.id !== exclude);
    return target;
  }, "Overlay WebView target not found");
  const client = await connect(target);
  await until(() => client.evaluate("!!document.querySelector('canvas')"), "Native WebView did not render the character");
  return client;
}

async function preference() {
  return overlay.evaluate("window.__TAURI_INTERNALS__.invoke('overlay_reduced_effects')");
}

async function setPreference(value) {
  if (await preference() !== value) control("effects");
  await until(async () => await preference() === value, "Tray preference did not reach Rust");
}

async function key(main, code, key, down) {
  const virtualKey = code === "ArrowRight" ? 39 : code === "KeyZ" ? 90 : code === "KeyX" ? 88 : 27;
  await main.rpc("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", key, code,
    windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
}

async function testLocalGame(main) {
  const deny = "command => window.__TAURI_INTERNALS__.invoke(command, {kind:'play',seq:1,movement:{x:0,y:0},ready:true}).then(() => false, () => true)";
  assert.equal(await overlay.evaluate(`(${deny})('local_control')`), true, "Overlay must not control the local game");
  assert.equal(await main.evaluate(`(${deny})('local_overlay_status')`), true, "Main must not claim overlay readiness");
  assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_control',{kind:'play',seq:0,movement:{x:0,y:0}}).then(() => false, () => true)"), true,
    "Invalid input must be rejected");
  control("hide");
  await until(() => main.evaluate("window.__TAURI_INTERNALS__.invoke('local_available').then(value => !value)"), "Hidden overlay still accepted input");
  control("show");
  await until(() => main.evaluate("document.querySelector('button')?.disabled === false"), "Local controls did not become ready");
  if (!await main.evaluate("document.hasFocus()")) {
    console.log("SKIP: native PLAY input requires an interactive foreground main window");
    return;
  }
  await main.evaluate("document.querySelector('button').click()");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('PLAY') || !!document.querySelector('[role=alert]')"), "PLAY did not start");
  const failure = await main.evaluate("document.querySelector('[role=alert]')?.textContent ?? ''");
  if (failure === "플레이 시작 실패: MAIN_NOT_FOCUSED") {
    assert.equal(await main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), true);
    console.log("SKIP: native PLAY input requires an interactive foreground main window");
    return;
  }
  assert.equal(failure, "", "Local play failed");
  await key(main, "ArrowRight", "ArrowRight", true);
  await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('모찌: walk')"), "Movement did not reach the overlay");
  await key(main, "ArrowRight", "ArrowRight", false);
  await key(main, "KeyZ", "z", true);
  await key(main, "KeyZ", "z", false);
  await until(() => overlay.evaluate("/민트: (hit|stun)/.test(document.querySelector('canvas')?.getAttribute('aria-description') ?? '')"), "Melee hit did not reach the overlay");
  await key(main, "KeyX", "x", true);
  await key(main, "KeyX", "x", false);
  await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('돌 1개')"), "Stone did not reach the overlay");
  await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('돌 0개')"), "Stone was not cleaned up");
  await key(main, "Escape", "Escape", true);
  await key(main, "Escape", "Escape", false);
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), "Escape did not return to WORK");
  console.log("PASS: local PLAY/WORK, arrow movement, melee, stone lifecycle, IPC scope and Escape");
}

async function launch() {
  app = spawn(executable, [], { windowsHide: true, env: { ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: profile } });
  app.on("error", (error) => { console.error(error); });
  overlay = await findOverlay();
}

try {
  await launch();
  originalPreference = await preference();
  assert.equal(typeof originalPreference, "boolean");
  assert.equal(control("state").coversPrimary, true);
  const mainTarget = (await pages()).find((page) => page.type === "page" && !page.url.includes("overlay.html"));
  assert.ok(mainTarget, "Main WebView target not found");
  const main = await connect(mainTarget);
  assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('overlay_reduced_effects').then(() => false, () => true)"), true,
    "Main must be denied the overlay-only command");
  if (localGame) await testLocalGame(main);
  await overlay.rpc("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  await setPreference(false);
  if (development) {
    assert.equal(await overlay.evaluate("location.origin"), "http://127.0.0.1:1420",
      "Source renderer tests require the local Tauri development URL");
    const { data: controllerImage } = await main.rpc("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(profileRoot, "m1-controller.png"), Buffer.from(controllerImage, "base64"));
    const { cssLayoutViewport: viewport } = await overlay.rpc("Page.getLayoutMetrics");
    const { data } = await overlay.rpc("Page.captureScreenshot", { format: "png", clip: {
      x: Math.max(0, viewport.clientWidth / 2 - 180), y: Math.max(0, viewport.clientHeight / 2 - 100),
      width: Math.min(360, viewport.clientWidth), height: Math.min(200, viewport.clientHeight), scale: 1,
    } });
    const screenshot = join(profileRoot, "m1-character-scene.png");
    writeFileSync(screenshot, Buffer.from(data, "base64"));
    console.log(`Character preview: ${screenshot}`);
    await overlay.evaluate("import('/scripts/test-overlay-rendering.mjs').then(module => module.testOverlayRendering())");
    // 오류 경로 검사는 Rust의 안전 숨김을 유발한다. 새 웹뷰를 생성해 뒤의 네이티브 회귀 검사를 계속한다.
    const previous = overlay.id;
    control("show");
    overlay = await findOverlay(previous);
    await overlay.rpc("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    console.log("PASS: M1 two-character renderer, transparent pixels, state animations and lifecycle");
  }
  await overlay.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    window.__m0Draws = 0;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced']) {
      const original = gl[name];
      gl[name] = function(...args) { window.__m0Draws++; return original.apply(this, args); };
    }
  })()`);
  await until(async () => await overlay.evaluate("window.__m0Draws > 2"), "Idle animation did not draw");
  await setPreference(true);
  // Observe a quiet interval after the one final reduced-motion frame.
  await overlay.evaluate("new Promise(resolve => setTimeout(resolve, 150))");
  const before = await overlay.evaluate("window.__m0Draws");
  await overlay.evaluate("new Promise(resolve => setTimeout(resolve, 250))");
  assert.equal(await overlay.evaluate("window.__m0Draws"), before, "Reduced effects must stop the render loop");
  control("exit");
  await until(() => app.exitCode !== null, "Tray exit did not terminate app");
  assert.equal(app.exitCode, 0);
  clients.forEach((client) => client.close());
  await launch();
  assert.equal(await preference(), true, "Effects preference did not survive restart");
  await setPreference(originalPreference);
  const oldTarget = overlay.id;
  await overlay.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl.getExtension('WEBGL_lose_context').loseContext();
  })()`);
  await until(() => !control("state").visible, "GPU failure did not hide the native overlay");
  control("show");
  overlay = await findOverlay(oldTarget);
  assert.equal(control("state").visible, true, "Tray did not recover failed renderer");
  assert.equal(await overlay.evaluate("getComputedStyle(document.body).backgroundColor"), "rgba(0, 0, 0, 0)");
  console.log("PASS: native monitor bounds, IPC denial, tray effects, idle stop, preference persistence, GPU failure hide and fresh renderer recovery");
} finally {
  if (app && app.exitCode === null) {
    if (typeof originalPreference === "boolean") {
      try { await setPreference(originalPreference); } catch (error) { console.error("Could not restore preference:", error.message); }
    }
    try { control("exit"); } catch { app.kill(); }
    await until(() => app.exitCode !== null, "Test process did not exit").catch(() => app.kill());
  }
  clients.forEach((client) => client.close());
  // Only remove this test's minted profile inside its known workspace cache.
  assert.equal(dirname(resolve(profile)), profileRoot);
  rmSync(profile, { recursive: true, force: true, maxRetries:10, retryDelay:100 });
}
