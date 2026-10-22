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

  for (const [name, width, height] of [["desktop-home", 800, 600], ["desktop-wide", 1100, 800], ["desktop-narrow", 540, 760], ["desktop-small", 360, 760], ["desktop-200-percent", 400, 300]]) {
    await main.rpc("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await main.evaluate("scrollTo(0, 0)");
    await main.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    assert.equal(await main.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${name}: horizontal overflow`);
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
  await click("내 공간");
  assert.equal(await main.evaluate("[...document.querySelectorAll('label')].find(l => l.textContent.trim() === '친구 방문 링크').querySelector('input').value"), "invalid-link", "Navigation must preserve form drafts");

  await until(() => main.evaluate("![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '집중 모드 켜기').disabled"), "Focus control did not become ready");
  await click("집중 모드 켜기");
  await until(() => main.evaluate("document.querySelector('.mode-badge').textContent.trim() === 'FOCUS'"), "Focus must update the mode badge");
  assert.equal(await main.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '방문하기').disabled"), true, "Focus must disable visits");
  await until(() => main.evaluate("![...document.querySelectorAll('button')].find(b => b.textContent.trim() === '집중 모드 끄기').disabled"), "Focus enable did not finish");
  await click("집중 모드 끄기");
  await until(() => main.evaluate("document.querySelector('.mode-badge').textContent.trim() === 'WORK'"), "Unfocus must restore WORK");
  await main.rpc("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await main.evaluate("getComputedStyle(document.querySelector('.character-portrait')).animationName"), "none", "Decorative motion must respect reduced motion");
  await main.rpc("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  console.log("PASS: desktop design, bundled font, 5 viewport sizes, 8 characters, input/error preservation, keyboard settings, focus and reduced motion");
}
