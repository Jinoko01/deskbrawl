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
const chatOnly = process.argv.includes("--chat");
const networkGame = process.argv.includes("--network") || hostControls || chatOnly;
const registeredLink = process.argv.includes("--registered-link");
const executable = process.env.DESKBRAWL_TEST_EXECUTABLE
  ? resolve(process.env.DESKBRAWL_TEST_EXECUTABLE)
  : fileURLToPath(new URL(`../src-tauri/target/${development ? "debug" : "release"}/deskbrawl.exe`, import.meta.url));
if (registeredLink && (!networkGame || development || !process.env.DESKBRAWL_TEST_EXECUTABLE)) {
  throw new Error("--registered-link requires --network and DESKBRAWL_TEST_EXECUTABLE pointing to the installed release app");
}
if (registeredLink) {
  const command = execFileSync("pwsh", ["-NoProfile", "-Command",
    "$ErrorActionPreference = 'Stop'; (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\\deskbrawl\\shell\\open\\command').'(default)'"],
  { encoding: "utf8", windowsHide: true }).trim();
  assert.equal(command.toLowerCase(), `"${executable}" "%1"`.toLowerCase(), "URI scheme must point to the installed test app");
}
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
  const [bindings, shortcutStatus] = await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_controls')");
  assert.equal(shortcutStatus, "registered", "Native shortcut regression requires the test app to own its saved shortcut");
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
  const foreground = control("state").foreground;
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
  assert.equal(control("state").foreground, foreground, "PLAY must preserve the foreground window");
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
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"),
    "Ctrl+Shift+G did not return to WORK");
  assert.equal(control("state").foreground, foreground, "WORK must preserve the foreground window");
  await testBackgroundInput(main, bindings[1]);
  control("home");
  console.log("PASS: foreground-preserving and minimized-main PLAY/WORK, movement, melee, stone, IPC scope and Escape");
}

async function testBackgroundInput(main, code) {
  let virtualKey;
  let scan;
  let extended = 0;
  const arrow = { ArrowUp: [38, 0x48], ArrowLeft: [37, 0x4b], ArrowDown: [40, 0x50], ArrowRight: [39, 0x4d] }[code];
  if (arrow) { [virtualKey, scan] = arrow; extended = 1; }
  else if (code === "Space") { virtualKey = 32; scan = 0x39; }
  else if (code.startsWith("Numpad")) { const digit = Number(code.slice(6)); virtualKey = 96 + digit; scan = [0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49][digit]; }
  else if (code.startsWith("Digit")) { const digit = Number(code.slice(5)); virtualKey = 48 + digit; scan = digit === 0 ? 0x0b : digit + 1; }
  else {
    const letter = code.slice(3);
    const row = [[0x10, "QWERTYUIOP"], [0x1e, "ASDFGHJKL"], [0x2c, "ZXCVBNM"]].find(([, letters]) => letters.includes(letter));
    assert.ok(row, `Unsupported native test key: ${code}`);
    virtualKey = letter.charCodeAt(0); scan = row[0] + row[1].indexOf(letter);
  }
  const probePath = join(profile, "background-input-probe.exe");
  const source = fileURLToPath(new URL("./fixtures/BackgroundInputProbe.cs", import.meta.url));
  execFileSync(join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    ["/nologo", "/r:System.Windows.Forms.dll", `/out:${probePath}`, source], { windowsHide: true });
  const probe = spawn(probePath, [], { windowsHide: false });
  let output = "";
  probe.stdout.on("data", (chunk) => { output += chunk.toString().replace(/\r/g, ""); });
  const send = (command) => probe.stdin.write(`${command}\n`);
  const wait = (predicate, message) => until(async () => {
    assert.ok(!output.includes("ERROR:"), output);
    return predicate();
  }, message);
  try {
    await wait(() => output.includes("READY"), "Owned work-window probe did not start");
    control("minimize-home");
    await wait(() => control("state").mainMinimized, "Main did not minimize");
    const foreground = control("state").foreground;
    send("toggle");
    await wait(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('PLAY ·')"), "Minimized main did not enter PLAY");
    assert.equal(control("state").mainMinimized, true, "PLAY must leave main minimized");
    assert.equal(control("state").foreground, foreground, "Background PLAY must preserve foreground");
    // Input is sent only while the probe owns foreground. PLAY must consume it first.
    send(`down ${virtualKey} ${scan} ${extended}`);
    try {
      await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('모찌: walk')"), "Background native movement did not reach overlay");
    } finally { send(`up ${virtualKey} ${scan} ${extended}`); }
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-description')?.includes('모찌: idle')"), "Native key release did not stop movement");
    assert.ok(!output.includes(`KEY:${virtualKey}\n`), "PLAY game keys must not reach the work window");
    send("down 27 1 0");
    send("up 27 1 0");
    await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), "Native Escape did not stop background PLAY");
    assert.equal(control("state").foreground, foreground, "WORK must preserve foreground");
    assert.equal(control("state").mainMinimized, true, "WORK must leave main minimized");
    send(`down ${virtualKey} ${scan} ${extended}`);
    send(`up ${virtualKey} ${scan} ${extended}`);
    await until(() => output.includes(`KEY:${virtualKey}\n`), "WORK must return game keys to the work window");
    assert.ok(!output.includes("ERROR:"), output);
    console.log("PASS: real background key capture/release, Escape, WORK input pass-through and minimized-main focus preservation");
  } finally {
    send("exit");
    await until(() => probe.exitCode !== null, "Owned probe did not exit").catch(() => probe.kill());
  }
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
  const joinGuest = () => ack("visit:join", { version: 2, token: new URL(ownLink).pathname.slice(6) });
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
  control("play-tray");
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
  control("minimize-home");
  await until(() => control("state").mainMinimized, "Main did not minimize");
  assert.equal((await ack("player:input", { visitId: entered.visitId, seq: 1, movement: { x: 0, y: 0 } })).ok, true,
    "Minimizing main must preserve the hosted session");
  control("home");
  await until(() => control("state").mainVisible && !control("state").mainMinimized, "Tray home did not restore main");

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

  control("minimize-home");
  await until(() => control("state").mainMinimized, "Main did not minimize");
  control("focus");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('FOCUS')"), "Tray focus did not synchronize with main");
  control("show");
  assert.equal(control("state").visible, false, "Tray show must not bypass focus");
  control("focus");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('WORK')"), "Tray unfocus did not synchronize with main");
  control("home");
  await until(() => !control("state").mainMinimized && control("state").mainVisible && control("state").visible, "Tray recovery failed");
  console.log("PASS: M3 focus, admission denial, link preservation, native input denial, single/all kick, stale input rejection, tray clipboard and background hosting");
}

async function testNetwork(main) {
  const base = process.env.DESKBRAWL_TEST_SERVER_ORIGIN ?? "http://127.0.0.1:3000";
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
  const guestSocket = io(base, { autoConnect: false, transports: ["websocket"], reconnection: false, auth: { version: 2, token: guest.accessToken } });
  const ack = (event, body) => guestSocket.timeout(5000).emitWithAck(event, body);
  try {
    await new Promise((resolve, reject) => { guestSocket.once("connect", resolve); guestSocket.once("connect_error", reject); guestSocket.connect(); });
    const entered = await ack("visit:join", { version: 2, token: new URL(ownLink).pathname.slice(6) });
    assert.equal(entered.ok, true);
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌와 민트 캐릭터'"), "Guest did not appear in native host overlay");
    await testSixNative(ownLink, api, base);
    await testNativeChat(main, guestSocket);
    if (chatOnly) return main;
    await testNativeRecovery(main);
    await ack("player:action", { visitId: entered.visitId, actionId: crypto.randomUUID(), action: "stone" });
    await until(() => overlay.evaluate("/모찌: (hit|stun)/.test(document.querySelector('canvas')?.getAttribute('aria-description') ?? '')"), "Authoritative guest stone hit did not reach native host");
    if (hostControls) await testHostControls(main, guestSocket, entered, ownLink);
    else await ack("visit:leave", { visitId: entered.visitId });
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌 캐릭터'"), "Departed visitor remained in overlay");

    const externalHost = await ack("room:host", { version: 2, bounds: { width: 1280, height: 720 } });
    assert.equal(externalHost.ok, true);
    const externalInvite = await api("/v1/rooms/me/invites", {}, guest.accessToken);
    const deepLink = `deskbrawl://join/${new URL(externalInvite.link).pathname.slice(6)}`;
    if (registeredLink) {
      execFileSync("pwsh", ["-NoProfile", "-Command",
        "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:DESKBRAWL_TEST_LINK"],
      { windowsHide: true, env: { ...process.env, DESKBRAWL_TEST_LINK: deepLink }, timeout: 10000 });
    } else {
      const second = spawn(executable, [deepLink], { windowsHide: true });
      await new Promise((resolve, reject) => { const timeout = setTimeout(() => { second.kill(); reject(new Error("Second app did not exit")); }, 10000); second.once("exit", () => { clearTimeout(timeout); resolve(); }); second.once("error", reject); });
    }
    await until(() => main.evaluate("document.body.textContent.includes('친구 공간 방문 중') && !!document.querySelector('canvas')"), "Running app did not accept the deep link into preview");
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌와 민트 캐릭터'"), "Visitor overlay must show the shared world");
    assert.equal(control("state").coversPrimary, true, "Visitor overlay must cover the primary desktop");
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
    await until(() => overlay.evaluate("/민트: (hit|stun)/.test(document.querySelector('canvas')?.getAttribute('aria-description') ?? '')"), "Server hit did not reach visitor desktop");
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
    await ack("visit:leave", { visitId: externalHost.visitId });
    const finalGuest = await ack("visit:join", { version: 2, token: new URL(ownLink).pathname.slice(6) });
    assert.equal(finalGuest.ok, true);
    const hostClosed = nextEvent(guestSocket, "room:closed");
    control("exit");
    assert.equal((await hostClosed).code, "HOST_OFFLINE", "Normal app exit must bypass disconnect grace");
    await until(() => app.exitCode !== null, "Test app did not exit before cold deep-link check");
    assert.equal((await ack("room:host", { version: 2, bounds: { width: 1280, height: 720 } })).ok, true);
    clients.forEach((client) => client.close());
    await launch([deepLink]);
    const target = (await pages()).find((page) => page.type === "page" && !page.url.includes("overlay.html"));
    assert.ok(target, "Restarted main WebView target not found");
    main = await connect(target);
    await until(() => main.evaluate("document.body.textContent.includes('친구 공간 방문 중') && !!document.querySelector('canvas')"), "Cold-start deep link did not restore device identity and join");
    guestSocket.disconnect();
    await until(() => main.evaluate("!!document.querySelector('[role=alert]')"), "Host closure did not report session end");
    await until(() => overlay.evaluate("window.__TAURI_INTERNALS__.invoke('network_read').then(v => JSON.parse(v).mode === 'local')"), "Host closure did not restore local mode");
    await until(() => overlay.evaluate("document.querySelector('canvas')?.getAttribute('aria-label') === '모찌와 민트 캐릭터'"), "Host closure left local characters invisible");
    assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_available')"), true, "Local PLAY must remain available after host closure");
    console.log("PASS: host disconnect restores visible local characters and local PLAY");
    console.log("PASS: native host overlay, shared stone hit, guest removal, single-instance deep-link forwarding, preview, return and IPC credential scope");
    console.log("PASS: cold-start deep link with DPAPI device identity restoration");
    if (registeredLink) console.log("PASS: installed Windows URI registration and ShellExecute forwarding into the running app (browser click is separate)");
    return main;
  } finally { guestSocket.disconnect(); }
}

async function testSixNative(link, api, base) {
  const members = [];
  try {
    for (let index = 3; index <= 6; index++) {
      const identity = await api("/v1/devices", { nickname: `M4 참가자${index}` });
      const peer = io(base, { autoConnect: false, transports: ["websocket"], reconnection: false, auth: { version: 2, token: identity.accessToken } });
      members.push({ peer });
      await new Promise((resolve, reject) => { peer.once("connect", resolve); peer.once("connect_error", reject); peer.connect(); });
      const joined = await peer.timeout(5000).emitWithAck("visit:join", { version: 2, token: new URL(link).pathname.slice(6) });
      assert.equal(joined.ok, true);
      members.at(-1).visitId = joined.visitId;
    }
    await until(() => overlay.evaluate("window.__TAURI_INTERNALS__.invoke('network_read').then(value => JSON.parse(value).snapshot.world.players.length === 6)"), "Six participants did not reach native overlay");
    await until(() => overlay.evaluate("(document.querySelector('canvas')?.getAttribute('aria-label').match(/캐릭터|민트/g) ?? []).length === 6"), "Six characters were not rendered");
    const image = await overlay.rpc("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(profileRoot, "m4-six-characters.png"), Buffer.from(image.data, "base64"));
    console.log("PASS: six real participants rendered on native full-desktop overlay");
  } finally {
    for (const { peer, visitId } of members) {
      if (visitId !== undefined) await peer.timeout(5000).emitWithAck("visit:leave", { visitId });
      peer.disconnect();
    }
  }
}

async function testNativeRecovery(main) {
  const before = await overlay.evaluate("window.__TAURI_INTERNALS__.invoke('network_read').then(JSON.parse)");
  const prototype = await main.rpc("Runtime.evaluate", { expression: "WebSocket.prototype" });
  const sockets = await main.rpc("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId });
  await main.rpc("Network.enable");
  await main.rpc("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await main.rpc("Runtime.callFunctionOn", { objectId: sockets.objects.objectId,
      functionDeclaration: "function() { for (const socket of this) if (socket.url.includes('/socket.io/')) socket.close(); }" });
    await until(() => main.evaluate("document.body.textContent.includes('연결이 끊겨 복구하는 중')"), "Transport loss did not show recovery");
    assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('local_available')"), false, "Recovery must block PLAY");
    const frozen = await overlay.evaluate("window.__TAURI_INTERNALS__.invoke('network_read').then(JSON.parse)");
    assert.equal(frozen.mode, "recovering");
    assert.equal(frozen.snapshot.worldId, before.snapshot.worldId);
  } finally {
    await main.rpc("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await main.rpc("Runtime.releaseObject", { objectId: sockets.objects.objectId });
    await main.rpc("Runtime.releaseObject", { objectId: prototype.result.objectId });
  }
  await until(() => main.evaluate("document.body.textContent.includes('내 공간 연결됨')"), "Native client did not resume hosted world");
  const after = await overlay.evaluate("window.__TAURI_INTERNALS__.invoke('network_read').then(JSON.parse)");
  assert.equal(after.snapshot.worldId, before.snapshot.worldId);
  assert.deepEqual(after.snapshot.world.players.map((player) => player.id), before.snapshot.world.players.map((player) => player.id));
  assert.ok(after.snapshot.world.tick >= before.snapshot.world.tick);
  console.log("PASS: native transport loss, frozen desktop, blocked PLAY and full snapshot resume without duplicate characters");
}

async function testNativeChat(main, peer) {
  control("minimize-home");
  const probePath = join(profile, "chat-input-probe.exe");
  const source = fileURLToPath(new URL("./fixtures/BackgroundInputProbe.cs", import.meta.url));
  execFileSync(join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    ["/nologo", "/r:System.Windows.Forms.dll", `/out:${probePath}`, source], { windowsHide: true });
  control("play-tray");
  await until(() => main.evaluate("document.querySelector('[role=status]')?.textContent?.includes('PLAY ·')"), "Background PLAY did not start for chat");
  const probe = spawn(probePath, [], { windowsHide: false });
  let output = "";
  let snapshot;
  const observe = (value) => { snapshot = value; };
  peer.on("world:snapshot", observe);
  probe.stdout.on("data", (chunk) => { output += chunk.toString().replace(/\r/g, ""); });
  const send = (command) => probe.stdin.write(`${command}\n`);
  try {
    await until(() => output.includes("READY") && /HANDLE:\d+/.test(output), "Chat foreground probe did not start");
    const foreground = Number(/HANDLE:(\d+)/.exec(output)[1]);
    send("slash");
    let target;
    await until(async () => { target = (await pages()).find((page) => page.url.includes("chat.html")); return target; }, "Native slash did not open chat")
      .catch(async (error) => { throw new Error(`${error.message}; probe=${output}; status=${JSON.stringify(await main.evaluate("[...document.querySelectorAll('[role=status],[role=alert]')].map(el => el.textContent)"))}`); });
    const chat = await connect(target);
    await until(() => chat.evaluate("document.activeElement?.id === 'message' && document.hasFocus()"), "Chat input did not receive explicit focus");
    assert.equal(control("state").mainMinimized, true, "Chat must not restore home");
    assert.ok(!output.includes("KEY:191\n"), "PLAY slash must be consumed");
    assert.equal(await chat.evaluate("window.__TAURI_INTERNALS__.invoke('credential_read').then(() => false, () => true)"), true, "Chat must not read credentials");
    assert.equal(await main.evaluate("window.__TAURI_INTERNALS__.invoke('chat_update', {current:'forged',previous:''}).then(() => false, () => true)"), true, "Only the editor can publish a draft");
    await chat.rpc("Input.insertText", { text: "안녕 친구" });
    await until(() => snapshot?.chats.some((draft) => draft.current === "안녕 친구"), "Live Korean draft did not reach peer before Enter");
    await chat.rpc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until(() => snapshot?.chats.some((draft) => draft.previous === "안녕 친구" && draft.current === ""), "Enter must move draft to previous line");
    assert.equal(await chat.evaluate("document.hasFocus()"), true, "Enter must leave editor open");
    await chat.rpc("Input.insertText", { text: "두 번째 줄" });
    await until(() => snapshot?.chats.some((draft) => draft.previous === "안녕 친구" && draft.current === "두 번째 줄"), "Two-line draft did not reach peer");
    const image = await chat.rpc("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(profileRoot, "m4-chat-editor.png"), Buffer.from(image.data, "base64"));
    const scene = await overlay.rpc("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(profileRoot, "m4-chat-overlay.png"), Buffer.from(scene.data, "base64"));
    await chat.rpc("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until(() => snapshot?.chats.length === 0, "Closing chat did not clear peer draft");
    await until(() => control("state").foreground === foreground, "Closing chat did not restore borrowed work focus")
      .catch((error) => { throw new Error(`${error.message}; expected=${foreground}; actual=${control("state").foreground}`); });
    assert.equal(control("state").mainMinimized, true);
    send("slash");
    await until(() => output.includes("KEY:191\n"), "WORK slash must pass through to work window");
    assert.ok(!output.includes("ERROR:"), output);
    console.log("PASS: native slash, minimized home, IME-capable Korean draft, two lines, IPC scope, Escape cleanup, borrowed focus restore and WORK slash pass-through");
  } finally {
    peer.off("world:snapshot", observe);
    send("exit");
    await until(() => probe.exitCode !== null, "Chat probe did not exit").catch(() => probe.kill());
    control("home");
  }
}

async function launch(args = []) {
  app = spawn(executable, args, { windowsHide: true, env: { ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    WEBVIEW2_USER_DATA_FOLDER: profile } });
  app.on("error", (error) => { console.error(error); });
  let startupError = "";
  app.stderr.on("data", (chunk) => {
    startupError = (startupError + chunk.toString()).slice(-2000);
  });
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
  // Both user-visible exit paths must terminate the process, overlay and tray,
  // including when native PLAY capture is active.
  for (const method of ["button", "window-close"]) {
    const target = (await pages()).find((page) => page.type === "page" && !page.url.includes("overlay.html"));
    const home = await connect(target);
    await until(() => home.evaluate("document.querySelector('[role=status]')?.textContent?.includes('플레이할 수 있음')"), "Exit test app did not become ready");
    assert.equal(await overlay.evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|close').then(() => false, () => true)"), true,
      "Overlay must not receive window-close permission");
    control("play-tray");
    await until(() => home.evaluate("document.querySelector('[role=status]')?.textContent?.includes('PLAY ·')"), "Exit test did not start PLAY");
    if (method === "button") {
      await home.evaluate("setTimeout(() => [...document.querySelectorAll('button')].find(button => button.textContent === '종료').click(), 0)");
    } else {
      control("close-home");
    }
    await until(() => app.exitCode !== null, `${method} did not terminate app`);
    assert.equal(app.exitCode, 0);
    control("assert-exited");
    console.log(`PASS: ${method} exits process, character overlay, tray and PLAY capture`);
    if (method === "button") await launch();
  }
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
