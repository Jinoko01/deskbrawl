// Run using the Node version in package.json after pnpm build.
// Uses WebView2's local diagnostic port only for this owned test process.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { io } from "socket.io-client";

// --dev는 Vite와 Tauri 개발 빌드가 준비된 경우에만 소스 기반 WebGL 검증도 실행한다.
const development = process.argv.includes("--dev");
const localGame = process.argv.includes("--local");
const hostControls = process.argv.includes("--m3");
const networkGame = process.argv.includes("--network") || hostControls;
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
  const virtualKey = { ArrowUp: 38, ArrowLeft: 37, ArrowDown: 40, ArrowRight: 39, Space: 32, Escape: 27 }[code]
    ?? (/^Key[A-Z]$/.test(code) ? code.charCodeAt(3) : /^Digit[0-9]$/.test(code) ? code.charCodeAt(5)
      : /^Numpad[0-9]$/.test(code) ? 96 + Number(code.at(-1)) : undefined);
  assert.ok(virtualKey, `Unsupported test key: ${code}`);
  await main.rpc("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", key, code,
    windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
}

async function testLocalGame(main) {
  await until(() => main.evaluate("document.body.textContent.includes('조작키 설정')"), "Saved controls did not finish loading");
  const [bindings] = await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_controls')");
  const gameKey = (index, down) => {
    const code = bindings[index];
    const value = code.startsWith("Key") ? code.slice(3).toLowerCase() : code.startsWith("Digit") ? code.slice(5)
      : code.startsWith("Numpad") ? code.slice(6) : code === "Space" ? " " : code;
    return key(main, code, value, down);
  };
  const deny = "command => window.__TAURI_INTERNALS__.invoke(command, {kind:'play',seq:1,movement:{x:0,y:0},ready:true}).then(() => false, () => true)";
  assert.equal(await overlay.evaluate(`(${deny})('local_control')`), true, "Overlay must not control the local game");
  assert.equal(await main.evaluate(`(${deny})('local_overlay_status')`), true, "Main must not claim overlay readiness");
  assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_control',{kind:'play',seq:0,movement:{x:0,y:0}}).then(() => false, () => true)"), true,
    "Invalid input must be rejected");
  control("hide");
  await until(() => main.evaluate("window.__TAURI_INTERNALS__.invoke('local_available').then(value => !value)"), "Hidden overlay still accepted input");
  control("show");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('플레이할 수 있음')"), "Local controls did not become ready");
  control("home");
  await until(() => main.evaluate("document.hasFocus()"), "Tray home did not focus the controller");
  control("play");
  const started = await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('PLAY ·') || !!document.querySelector('[role=alert]')"), "PLAY did not start")
    .then(() => true, (error) => error);
  const failure = await main.evaluate("document.querySelector('[role=alert]')?.textContent ?? ''");
  if (started !== true || failure === "플레이 시작 실패: MAIN_NOT_FOCUSED") {
    if (await main.evaluate("document.hasFocus()")) throw started === true ? new Error(failure) : started;
    assert.equal(await main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), true);
    console.log("SKIP: native PLAY input requires an interactive foreground main window");
    return;
  }
  assert.equal(failure, "", "Local play failed");
  await gameKey(3, true);
  // A defined 150 ms held-key input closes the initial 144-unit gap into melee
  // range. The first WALK frame alone can represent only 12 units of movement.
  await main.evaluate("new Promise(resolve => setTimeout(resolve, 150))");
  await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('모찌: walk')"), "Movement did not reach the overlay");
  await gameKey(3, false);
  await gameKey(4, true);
  await gameKey(4, false);
  await until(() => overlay.evaluate("/민트: (hit|stun)/.test(document.querySelector('canvas')?.getAttribute('aria-description') ?? '')"), "Melee hit did not reach the overlay");
  await gameKey(5, true);
  await gameKey(5, false);
  await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('돌 1개')"), "Stone did not reach the overlay");
  await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('돌 0개')"), "Stone was not cleaned up");
  await key(main, "Escape", "Escape", true);
  await key(main, "Escape", "Escape", false);
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), "Escape did not return to WORK");
  control("play");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('PLAY ·')"), "Ctrl+Shift+G did not enter PLAY again");
  control("play");
  await until(() => main.evaluate("!document.hasFocus() && document.querySelector('[role=status]')?.textContent?.includes('WORK')"),
    "Ctrl+Shift+G did not return focus and WORK");
  console.log("PASS: Ctrl+Shift+G PLAY/WORK, arrow movement, melee, stone lifecycle, IPC scope and Escape");
}

function nextEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, receive);
      reject(new Error(`Socket event timeout: ${event}`));
    }, 5000);
    function receive(value) { clearTimeout(timer); resolve(value); }
    socket.once(event, receive);
  });
}

async function testHostControls(main, guestSocket, entered, ownLink) {
  const ack = (event, body) => guestSocket.timeout(5000).emitWithAck(event, body);
  const click = (label) => main.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)} && !b.disabled).click()`);
  const joinGuest = () => ack("visit:join", { version: 1, token: new URL(ownLink).pathname.slice(6) });
  for (const command of ["focus_read", "focus_set", "invite_publish"]) {
    assert.equal(await overlay.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, {focused:true,link:null}).then(() => false, () => true)`), true,
      `${command} must stay main-only`);
  }
  const unavailable = nextEvent(guestSocket, "room:closed");
  await click("집중 모드 켜기");
  assert.equal((await unavailable).code, "ROOM_UNAVAILABLE");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('FOCUS')"), "Focus status did not reach main");
  await until(() => !control("state").visible, "Focus did not hide the overlay");
  assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_available')"), false);
  assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_control',{kind:'play',seq:1,movement:{x:0,y:0}}).then(() => false, () => true)"), true,
    "Focus must reject native PLAY");
  control("play");
  assert.equal(await main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('FOCUS')"), true);
  const rejected = await joinGuest();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "ROOM_UNAVAILABLE");
  assert.equal(await main.evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.startsWith('내 방문 링크')).querySelector('input').value"), ownLink,
    "Focus must preserve the invitation");
  await click("집중 모드 끄기");
  await until(() => control("state").visible, "Unfocus did not restore the overlay");
  entered = await joinGuest();
  assert.equal(entered.ok, true, "The existing link must work after unfocus");
  await until(() => main.evaluate(`!!document.querySelector('button[aria-label="M2 테스트 방문자 내보내기"]')`), "Host member controls did not appear");

  // Capture the actual WebView without leaking its bearer invitation.
  await main.evaluate("document.querySelectorAll('input[readonly]').forEach(input => { input.type = 'password'; })");
  for (const [name, width, height] of [["m3-host-controls", 800, 600], ["m3-host-controls-narrow", 540, 760]]) {
    await main.rpc("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    assert.equal(await main.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Host controls overflow horizontally");
    const screenshot = await main.rpc("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(profileRoot, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await main.rpc("Emulation.clearDeviceMetricsOverride");
  await main.evaluate("document.querySelectorAll('input[readonly]').forEach(input => { input.type = 'text'; })");

  control("copy");
  execFileSync("pwsh", ["-NoProfile", "-Command",
    "$ErrorActionPreference = 'Stop'; if ((Get-Clipboard -Raw).TrimEnd() -cne $env:DESKBRAWL_EXPECTED_LINK) { throw 'Tray clipboard does not match the generated link' }"],
  { windowsHide: true, env: { ...process.env, DESKBRAWL_EXPECTED_LINK: ownLink } });
  control("close-home");
  await until(() => !control("state").mainVisible, "Closing main did not hide it");
  assert.equal((await ack("player:input", { visitId: entered.visitId, seq: 1, movement: { x: 0, y: 0 } })).ok, true,
    "Closing main must preserve the hosted session");
  control("home");
  await until(() => control("state").mainVisible, "Tray home did not restore main");

  const kicked = nextEvent(guestSocket, "room:closed");
  await click("내보내기");
  assert.equal((await kicked).code, "KICKED");
  assert.equal((await ack("player:input", { visitId: entered.visitId, seq: 2, movement: { x: 1, y: 0 } })).code, "SESSION_ENDED");
  assert.equal((await ack("player:action", { visitId: entered.visitId, actionId: crypto.randomUUID(), action: "stone" })).code, "SESSION_ENDED");
  assert.equal((await joinGuest()).ok, true);
  await until(() => main.evaluate(`!!document.querySelector('button[aria-label="M2 테스트 방문자 내보내기"]')`), "Rejoined member did not appear");
  const cleared = nextEvent(guestSocket, "room:closed");
  await click("모두 내보내기");
  assert.equal((await cleared).code, "KICKED");
  await until(() => main.evaluate("document.body.textContent.includes('현재 방문자가 없어요.')"), "Clear visitors did not update member list");

  control("close-home");
  await until(() => !control("state").mainVisible, "Main did not return to tray");
  control("focus");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('FOCUS')"), "Tray focus did not synchronize with main");
  control("show");
  assert.equal(control("state").visible, false, "Tray show must not bypass focus");
  control("focus");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), "Tray unfocus did not synchronize with main");
  control("home");
  await until(() => control("state").mainVisible && control("state").visible, "Tray recovery failed");
  console.log("PASS: M3 focus, admission denial, link preservation, native input denial, single/all kick, stale input rejection, tray clipboard and background hosting");
}

async function testNetwork(main) {
  const base = "http://127.0.0.1:3000";
  const api = async (path, body, accessToken) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify(body) });
    assert.ok(response.ok, `Fixture request failed: ${response.status}`);
    return response.json();
  };
  const denied = async (client, command) => client.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}).then(() => false, () => true)`);
  assert.equal(await denied(overlay, "credential_read"), true, "Overlay must not read device credentials");
  assert.equal(await denied(main, "network_read"), true, "Main must not read overlay IPC state");
  await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '내 공간 연결').click()");
  await until(() => main.evaluate("document.body.textContent.includes('내 공간 연결됨')"), "Native main did not host a room");
  await until(() => overlay.evaluate("window.__TAURI_INTERNALS__.invoke('network_read').then(v => JSON.parse(v).mode === 'host')"), "Host world did not reach overlay");
  await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '방문 링크 생성').click()");
  let ownLink;
  await until(async () => {
    ownLink = await main.evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.startsWith('내 방문 링크'))?.querySelector('input')?.value");
    return !!ownLink;
  }, "Host invite link not created");
  const guest = await api("/v1/devices", { nickname: "M2 테스트 방문자" });
  const guestSocket = io(base, { autoConnect: false, transports: ["websocket"], reconnection: false, auth: { version: 1, token: guest.accessToken } });
  const ack = (event, body) => guestSocket.timeout(5000).emitWithAck(event, body);
  try {
    await new Promise((resolve, reject) => { guestSocket.once("connect", resolve); guestSocket.once("connect_error", reject); guestSocket.connect(); });
    const entered = await ack("visit:join", { version: 1, token: new URL(ownLink).pathname.slice(6) });
    assert.equal(entered.ok, true);
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌와 민트 캐릭터'"), "Guest did not appear in native host overlay");
    await ack("player:action", { visitId: entered.visitId, actionId: crypto.randomUUID(), action: "stone" });
    await until(() => overlay.evaluate("/모찌: (hit|stun)/.test(document.querySelector('canvas')?.getAttribute('aria-description') ?? '')"), "Authoritative guest stone hit did not reach native host");
    if (hostControls) await testHostControls(main, guestSocket, entered, ownLink);
    else await ack("visit:leave", { visitId: entered.visitId });
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌 캐릭터'"), "Departed visitor remained in overlay");

    const externalHost = await ack("room:host", { version: 1, bounds: { width: 1280, height: 720 } });
    assert.equal(externalHost.ok, true);
    const externalInvite = await api("/v1/rooms/me/invites", {}, guest.accessToken);
    const deepLink = `deskbrawl://join/${new URL(externalInvite.link).pathname.slice(6)}`;
    const second = spawn(executable, [deepLink], { windowsHide: true });
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => { second.kill(); reject(new Error("Second app did not exit")); }, 10000); second.once("exit", () => { clearTimeout(timeout); resolve(); }); second.once("error", reject); });
    await until(() => main.evaluate("document.body.textContent.includes('친구 공간 방문 중') && !!document.querySelector('canvas')"), "Running app did not accept the deep link into preview");
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '표시된 캐릭터 없음'"), "Own overlay should be empty while visiting");
    await until(() => main.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌와 민트 캐릭터'"), "Preview does not show the shared world");
    assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('preview_reduced_effects').then(v => typeof v === 'boolean')"), true);
    assert.equal(await denied(overlay, "preview_reduced_effects"), true, "Preview preference read must stay main-only");
    await main.evaluate(`(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      window.__m2Draws = 0;
      for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced']) {
        const original = gl[name];
        gl[name] = function(...args) { window.__m2Draws++; return original.apply(this, args); };
      }
    })()`);
    await setPreference(false);
    await until(() => main.evaluate("window.__m2Draws > 2"), "Preview idle animation did not draw");
    await setPreference(true);
    await main.evaluate("new Promise(resolve => setTimeout(resolve, 150))");
    const previewDraws = await main.evaluate("window.__m2Draws");
    await main.evaluate("new Promise(resolve => setTimeout(resolve, 250))");
    assert.equal(await main.evaluate("window.__m2Draws"), previewDraws, "Idle network snapshots must not redraw reduced preview");
    await ack("player:action", { visitId: externalHost.visitId, actionId: crypto.randomUUID(), action: "stone" });
    await until(() => main.evaluate("/민트: (hit|stun)/.test(document.querySelector('canvas')?.getAttribute('aria-description') ?? '')"), "Server hit did not reach visitor preview");
    const screenshot = await main.rpc("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(profileRoot, "m2-visit-preview.png"), Buffer.from(screenshot.data, "base64"));
    if (hostControls) {
      await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '집중 모드 켜기').click()");
      await until(() => main.evaluate("document.body.textContent.includes('내 공간 연결됨') && document.querySelector('[role=status]')?.textContent?.includes('FOCUS')"),
        "Focus while visiting did not leave and protect own room");
      await until(() => !control("state").visible, "Visiting focus left the overlay visible");
      await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '집중 모드 끄기').click()");
    } else {
      await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '귀환').click()");
    }
    await until(() => main.evaluate("document.body.textContent.includes('내 공간 연결됨')"), "Return did not restore own hosted room");
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌 캐릭터'"), "Return did not restore host overlay");
    // Restart with the same encrypted device identity and a startup deep link.
    control("exit");
    await until(() => app.exitCode !== null, "Test app did not exit before cold deep-link check");
    clients.forEach((client) => client.close());
    await launch([deepLink]);
    const target = (await pages()).find((page) => page.type === "page" && !page.url.includes("overlay.html"));
    assert.ok(target, "Restarted main WebView target not found");
    main = await connect(target);
    await until(() => main.evaluate("document.body.textContent.includes('친구 공간 방문 중') && !!document.querySelector('canvas')"), "Cold-start deep link did not restore device identity and join");
    await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '귀환').click()");
    await until(() => main.evaluate("document.body.textContent.includes('내 공간 연결됨')"), "Cold-start return failed");
    console.log("PASS: native host overlay, shared stone hit, guest removal, single-instance deep-link forwarding, preview, return and IPC credential scope");
    console.log("PASS: cold-start deep link with DPAPI device identity restoration");
    return main;
  } finally { guestSocket.disconnect(); }
}

async function launch(args = []) {
  app = spawn(executable, args, { windowsHide: true, env: { ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: profile } });
  app.on("error", (error) => { console.error(error); });
  let startupError = "";
  app.stderr.on("data", (chunk) => { startupError = (startupError + chunk.toString()).slice(-2000); });
  try { overlay = await findOverlay(); }
  catch (error) { throw new Error(`${error.message}; app exit=${app.exitCode}; ${startupError}`); }
}

try {
  await launch();
  originalPreference = await preference();
  assert.equal(typeof originalPreference, "boolean");
  assert.equal(control("state").coversPrimary, true);
  const mainTarget = (await pages()).find((page) => page.type === "page" && !page.url.includes("overlay.html"));
  assert.ok(mainTarget, "Main WebView target not found");
  let main = await connect(mainTarget);
  assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('overlay_reduced_effects').then(() => false, () => true)"), true,
    "Main must be denied the overlay-only command");
  if (localGame) await testLocalGame(main);
  if (networkGame) main = await testNetwork(main);
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
