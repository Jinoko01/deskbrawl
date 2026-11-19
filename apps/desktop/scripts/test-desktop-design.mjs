import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Runs inside the existing owned Windows WebView harness; no IPC mocks.
export async function testDesktopDesign(main, output, until) {
  const click = (text) => main.evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled).click()`);
  const visible = (selector) => main.evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  await until(() => main.evaluate("!!document.querySelector('#control-settings-title')"), "Controls did not load");
  await main.evaluate("document.fonts.ready");
  assert.equal(await main.evaluate("document.fonts.check('500 14px Pretendard')"), true, "Bundled Korean font did not load");
  assert.equal(await visible("#control-settings-title"), false, "Settings must not compete with the initial connection flow");
  assert.equal(await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '방문하기').disabled"), true, "Empty visit link must not submit");

  const coachmarkVisible = () => visible("#mode-coachmark:popover-open");
  async function openTopic(label) {
    await click("도움말");
    assert.equal(await visible("#help-topics:popover-open"), true, "Help must open its topic list");
    await click(label);
    assert.equal(await visible("#help-topics:popover-open"), false, "Selecting a topic must close the list");
    assert.equal(await coachmarkVisible(), true, `${label}: the coachmark must open`);
  }
  const saveScreenshot = async (name) => {
    const { data } = await main.rpc("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, `${name}.png`), Buffer.from(data, "base64"));
  };
  await main.rpc("Emulation.setDeviceMetricsOverride", { width: 700, height: 560, deviceScaleFactor: 1, mobile: false });
  assert.equal(await coachmarkVisible(), true, "A fresh profile must show the mode coachmark");
  assert.equal(await main.evaluate("document.activeElement.textContent.trim()"), "닫기");
  assert.equal(await main.evaluate("document.querySelector('#mode-coachmark').textContent.includes('작업 모드')"), true);
  const spotlight = await main.evaluate(`(() => {
    const target = document.querySelector('[data-coach-target]');
    const {left, top, width, height} = target.getBoundingClientRect();
    const hit = document.elementFromPoint(left + width / 2, top + height / 2);
    const guide = document.querySelector('#mode-coachmark').getBoundingClientRect();
    return { target: target.classList.contains('mode-start'), clickable: target.contains(hit),
      floating: guide.top >= top + height || guide.bottom <= top, top };
  })()`);
  assert.equal(spotlight.target && spotlight.clickable && spotlight.floating, true, "The floating guide must leave the real Play button clickable");
  assert.equal(await main.evaluate("document.querySelector('.play-key-layout').getBoundingClientRect().bottom <= innerHeight"), true,
    "All keys must be visible on first launch at the minimum window size");
  assert.deepEqual(await main.evaluate(`[...document.querySelectorAll('.play-key-layout kbd')].slice(0, 6).map(kbd => kbd.lastChild.textContent)
    .map(label => label.trim())`), await main.evaluate("[...document.querySelectorAll('.key-binding')].slice(0, 6).map(button => button.textContent.trim())"),
  "The guide must match the saved bindings");
  await saveScreenshot("desktop-mode-coachmark");
  await main.rpc("Emulation.setDeviceMetricsOverride", { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
  await main.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const zoomed = await main.evaluate(`(() => {
    const guide = document.querySelector('#mode-coachmark').getBoundingClientRect();
    const target = document.querySelector('[data-coach-target]').getBoundingClientRect();
    return { guide: guide.toJSON(), target: target.toJSON(), width: innerWidth, height: innerHeight };
  })()`);
  await saveScreenshot("desktop-mode-coachmark-zoomed");
  const { guide, target, width, height } = zoomed;
  assert.ok(guide.top >= 0 && guide.bottom <= height && guide.left >= 0 && guide.right <= width
    && target.top >= 0 && target.bottom <= height && (guide.top >= target.bottom || guide.bottom <= target.top),
  `The guide must fit a zoomed window without covering Play: ${JSON.stringify(zoomed)}`);
  await main.rpc("Emulation.setDeviceMetricsOverride", { width: 700, height: 560, deviceScaleFactor: 1, mobile: false });
  await main.evaluate("scrollTo(0, 0)");
  await click("닫기");
  assert.equal(await coachmarkVisible(), false);
  assert.equal(await main.evaluate("document.querySelector('.mode-start').getBoundingClientRect().top"), spotlight.top,
    "Closing the coachmark must not move the controls");
  assert.equal(await main.evaluate("document.activeElement.textContent.trim()"), "도움말");
  const firstRun = await main.evaluate("performance.timeOrigin");
  await main.rpc("Page.reload");
  await until(() => main.evaluate(`performance.timeOrigin !== ${firstRun} && !!document.querySelector('#control-settings-title')`), "Controls did not reload");
  assert.equal(await coachmarkVisible(), false, "Dismissing the guide must suppress it on next launch");
  await main.rpc("Emulation.clearDeviceMetricsOverride");

  for (const [name, width, height] of [["desktop-home", 800, 600], ["desktop-wide", 1100, 800], ["desktop-narrow", 540, 760], ["desktop-small", 360, 760], ["desktop-200-percent", 400, 300]]) {
    await main.rpc("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await main.evaluate("scrollTo(0, 0)");
    await main.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    assert.equal(await main.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${name}: horizontal overflow`);
    assert.ok(await main.evaluate("document.querySelector('.visit-link-controls input').getBoundingClientRect().width >= 120"),
      `${name}: the visit link must leave room to read and edit the address`);
    assert.equal(await main.evaluate("document.querySelector('.play-key-layout').getBoundingClientRect().bottom <= innerHeight"), true,
      `${name}: all keys must be above the fold`);
    if (name === "desktop-home") {
      const actions = await main.evaluate(`[...document.querySelectorAll('button')]
        .filter(button => /^(플레이 시작|내 공간 연결)/.test(button.textContent.trim()))
        .map(button => ({ label: button.textContent.trim(), top: button.getBoundingClientRect().top, bottom: button.getBoundingClientRect().bottom }))`);
      assert.equal(actions.filter(({ top, bottom }) => top >= 0 && bottom <= height).length, 2,
        `Play and connect must be above the fold: ${JSON.stringify(actions)}`);
    }
    assert.equal(await main.evaluate(`(() => {
      const portrait = document.querySelector('svg[role=img]').getBoundingClientRect();
      const previous = document.querySelector('[aria-label="이전 캐릭터"]').getBoundingClientRect();
      const next = document.querySelector('[aria-label="다음 캐릭터"]').getBoundingClientRect();
      return previous.right <= portrait.left && next.left >= portrait.right;
    })()`), true, `${name}: arrows must flank the character image`);
    const { cssContentSize } = await main.rpc("Page.getLayoutMetrics");
    const image = await main.rpc("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: name === "desktop-wide" ? cssContentSize.height : height, scale: 1 } });
    writeFileSync(join(output, `${name}.png`), Buffer.from(image.data, "base64"));
  }
  await main.rpc("Emulation.clearDeviceMetricsOverride");

  const names = ["모찌", "민트", "써니", "코랄", "루미", "러스티", "바이트", "베리"];
  const original = await main.evaluate("document.querySelector('svg[role=img]').getAttribute('aria-label')");
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const label = await main.evaluate("document.querySelector('svg[role=img]').getAttribute('aria-label')");
    assert.ok(names.some(name => label === `${name} 캐릭터 미리보기`));
    seen.add(label);
    await main.evaluate("document.querySelector('[aria-label=\"다음 캐릭터\"]').click()");
    await until(() => main.evaluate(`document.querySelector('svg[role=img]').getAttribute('aria-label') !== ${JSON.stringify(label)} && !document.querySelector('[aria-label="다음 캐릭터"]').disabled`), "Character selection did not settle");
  }
  assert.equal(seen.size, 8);
  assert.equal(await main.evaluate("document.querySelector('svg[role=img]').getAttribute('aria-label')"), original, "Carousel must wrap");
  assert.deepEqual(await main.evaluate("[...document.querySelectorAll('.character-option')].map(button => button.getAttribute('aria-label'))"), names);
  await main.evaluate("document.querySelector('.character-option[aria-label=베리]').click()");
  await until(() => main.evaluate("document.querySelector('.character-option[aria-label=베리][aria-pressed=true]') !== null"), "Direct selection did not select Berry");

  await main.evaluate(`(() => {
    const input = [...document.querySelectorAll('label')].find(label => label.textContent.trim() === '친구 방문 링크').querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'invalid-link');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until(() => main.evaluate("![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '방문하기').disabled"), "Valid input presence did not enable visit action");
  await click("방문하기");
  await until(() => main.evaluate("!!document.querySelector('[role=alert]')"), "Invalid link must show an actionable error");
  assert.equal(await main.evaluate("document.querySelector('#visit-error').closest('form').querySelector('input').getAttribute('aria-invalid')"), "true", "Visit error must describe the related field");
  assert.equal(await main.evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.trim() === '친구 방문 링크').querySelector('input').value"), "invalid-link", "Failed visit must preserve the input");

  await click("조작 설정");
  assert.equal(await visible("#control-settings-title"), true);
  assert.equal(await visible("#profile-title"), false);
  const keyName = await main.evaluate("document.querySelector('.key-binding').getAttribute('aria-label')");
  await main.evaluate("document.querySelector('.key-binding').focus()");
  await main.rpc("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await main.rpc("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(() => main.evaluate("document.querySelector('.key-binding').getAttribute('aria-pressed') === 'true'"), "Keyboard activation must start recording");
  await main.rpc("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await main.rpc("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await main.evaluate("document.querySelector('.key-binding').getAttribute('aria-label')"), keyName, "Escape must cancel without changing the binding");
  await main.evaluate("Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation => animation.finished))");
  const settingsImage = await main.rpc("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(output, "desktop-settings.png"), Buffer.from(settingsImage.data, "base64"));
  await openTopic("플레이와 작업 전환");
  assert.equal(await visible("#profile-title"), true, "Selecting help from settings must reveal the home controls");
  assert.equal(await main.evaluate("document.activeElement.textContent.trim()"), "닫기");
  await main.rpc("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await main.rpc("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await coachmarkVisible(), false, "Escape must dismiss help in Work mode");
  await openTopic("플레이와 작업 전환");
  await main.rpc("Input.dispatchMouseEvent", { type: "mousePressed", x: 100, y: 30, button: "left", clickCount: 1 });
  await main.rpc("Input.dispatchMouseEvent", { type: "mouseReleased", x: 100, y: 30, button: "left", clickCount: 1 });
  await until(async () => !await coachmarkVisible(), "Clicking outside must dismiss the guide");
  assert.equal(await main.evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.trim() === '친구 방문 링크').querySelector('input').value"), "invalid-link", "Navigation must preserve form drafts");

  for (const [topic, label, selector] of [
    ["keys", "조작키", ".play-key-layout[data-coach-target]"],
    ["space", "공간 연결", 'button[form="profile-form"][data-coach-target]'],
    ["visit", "친구에게 놀러 가기", ".visit-link-controls[data-coach-target]"],
  ]) {
    await openTopic(label);
    assert.equal(await main.evaluate(`document.querySelector('#mode-coachmark').dataset.topic === ${JSON.stringify(topic)}`), true);
    assert.equal(await main.evaluate(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const guide = document.querySelector('#mode-coachmark').getBoundingClientRect();
      return target.top >= 0 && target.bottom <= innerHeight && guide.top >= 0 && guide.bottom <= innerHeight
        && (guide.top >= target.bottom || guide.bottom <= target.top);
    })()`), true, `${label}: the coachmark must reveal its real control and leave it uncovered`);
    await saveScreenshot(`desktop-coachmark-${topic}`);
    await click("닫기");
    assert.equal(await coachmarkVisible(), false);
  }

  await until(() => main.evaluate("!document.querySelector('[role=switch]').disabled"), "Focus control did not become ready");
  await click("집중 모드");
  await until(() => main.evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true' && document.querySelector('#play-mode').textContent === '집중 모드'"), "Focus must update the switch and mode");
  assert.equal(await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '방문하기').disabled"), true, "Focus must disable visits");
  await until(() => main.evaluate("!document.querySelector('[role=switch]').disabled"), "Focus enable did not finish");
  await click("집중 모드");
  await until(() => main.evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false' && document.querySelector('#play-mode').textContent === '작업 모드'"), "Unfocus must restore work mode");
  await main.rpc("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await main.evaluate("getComputedStyle(document.querySelector('.character-portrait')).animationName"), "none", "Decorative motion must respect reduced motion");
  await main.rpc("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  console.log("PASS: first-run coachmark, four help topics, dismissal and replay, saved key guide, desktop design, bundled font, responsive layouts, keyboard settings and focus");
}
