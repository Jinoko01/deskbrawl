import type { MovementAxis, PlayerAction, Vector2, WorldState } from "@deskbrawl/game-core";
import { createGame, FRIEND, HOST } from "./game";
import { createRenderer, drawPortrait, loadSkin, SKIN_NAMES, SKINS } from "./render";
import type { Skin } from "./render";

type Mode = "work" | "play";
type Step = "play" | "move" | "invite" | "hit" | "focus";

const STEP_COUNT = 5;
const OUCH = ["아야!", "어쭈?", "반칙이야 ㅋㅋ"];
const TAUNT = ["톡!", "ㅋㅋㅋ", "잡아 봐~"];

function need<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`요소가 없습니다: ${selector}`);
  }
  return found;
}

function axisOf(negative: boolean, positive: boolean): MovementAxis {
  if (negative === positive) {
    return 0;
  }
  return positive ? 1 : -1;
}

function pickLine(lines: readonly string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? "";
}

async function start(): Promise<void> {
  const root = document.documentElement;
  const canvas = need<HTMLCanvasElement>("#overlay");
  const grab = need<HTMLElement>("#grab");
  const hint = need<HTMLElement>("#hint");
  const friendSay = need<HTMLElement>("#friend-say");
  const noticeBox = need<HTMLElement>("#notice");
  const workButton = need<HTMLButtonElement>("#mode-work");
  const playButton = need<HTMLButtonElement>("#mode-play");
  const playCta = need<HTMLButtonElement>("#play-cta");
  const playCtaLabel = need<HTMLElement>("#play-cta-label");
  const playCtaKey = need<HTMLElement>("#play-cta-key");
  const downloadCta = document.querySelector<HTMLAnchorElement>("#download-cta[href]");
  const todo = need<HTMLElement>("#todo");
  const doneLine = need<HTMLElement>("#done");
  const chatLog = need<HTMLElement>("#chat-log");
  const inviteButton = need<HTMLButtonElement>("#invite");
  const inviteLabel = need<HTMLElement>("#invite-label");
  const portrait = need<HTMLCanvasElement>("#portrait");
  const skinName = need<HTMLElement>("#skin-name");
  const focusButton = need<HTMLButtonElement>("#focus");
  const clock = need<HTMLElement>("#clock");

  const touch = matchMedia("(pointer: coarse)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  root.dataset.input = touch ? "touch" : "keys";

  const viewport = { width: root.clientWidth, height: root.clientHeight };
  const game = createGame(viewport.width, viewport.height);
  const renderer = await createRenderer(canvas);
  await Promise.all([loadSkin("mochi"), loadSkin("mint")]);

  let mode: Mode = "work";
  let focus = false;
  let skin: Skin = "mochi";
  let friendSkin: Skin = "mint";
  let size = 96;
  let raf = 0;
  let travelled = 0;
  let lastHost: Vector2 | undefined;
  let friendHitTick: number | null = null;
  let hostHitTick: number | null = null;
  let sayUntil = 0;
  let noticeTimer: number | undefined;
  let hintHtml = "";
  const done = new Set<Step>();
  const noticed = new Set<string>();
  const held = new Set<string>();


  // once를 주면 같은 안내는 한 번만 띄운다. 반복 알림으로 방해하지 않는다.
  function notice(text: string, once?: string): void {
    if (once !== undefined) {
      if (noticed.has(once)) {
        return;
      }
      noticed.add(once);
    }
    noticeBox.textContent = text;
    noticeBox.dataset.show = "";
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      delete noticeBox.dataset.show;
    }, 3600);
  }

  function hintFor(): string {
    if (focus) {
      return "";
    }
    if (mode === "work" && !done.has("play")) {
      return touch ? "PLAY를 눌러 보세요" : "<kbd>Space</kbd>를 눌러 보세요";
    }
    if (mode === "play" && !done.has("move")) {
      return touch ? "아래 패드로 움직여요" : "방향키로 움직여요";
    }
    if (!done.has("invite")) {
      return "메신저에서 지호를 불러요";
    }
    if (game.hasFriend && !done.has("hit")) {
      if (mode === "play") {
        return touch ? "톡 치거나 돌을 던져요" : "<kbd>Z</kbd> 톡 치기 · <kbd>X</kbd> 돌 던지기";
      }
      return touch ? "PLAY를 눌러 다시 놀아요" : "<kbd>Space</kbd>를 눌러 다시 놀아요";
    }
    return "";
  }

  function updateHint(): void {
    const next = hintFor();
    if (next !== hintHtml) {
      hintHtml = next;
      // 위의 고정 문구만 넣는다. 외부 입력은 들어오지 않는다.
      hint.innerHTML = next;
    }
    hint.hidden = next === "";
  }

  function complete(step: Step): void {
    if (done.has(step)) {
      return;
    }
    done.add(step);
    const item = todo.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (item !== null) {
      item.dataset.done = "";
      const mark = document.createElement("span");
      mark.className = "sr-only";
      mark.textContent = " (완료)";
      item.append(mark);
    }
    if (step === "hit" && downloadCta !== null) {
      downloadCta.classList.add("btn--primary");
      playCta.classList.remove("btn--primary");
    }
    doneLine.hidden = done.size < STEP_COUNT;
    updateHint();
  }

  function sendControl(action?: PlayerAction): void {
    game.control({
      x: axisOf(held.has("ArrowLeft"), held.has("ArrowRight")),
      y: axisOf(held.has("ArrowUp"), held.has("ArrowDown")),
    }, action);
  }

  function setMode(next: Mode): void {
    if (next === mode) {
      return;
    }
    if (next === "play" && focus) {
      notice("집중 모드를 끄면 PLAY를 시작할 수 있어요.");
      return;
    }
    mode = next;
    root.dataset.mode = next;
    held.clear();
    game.setPlaying(next === "play");
    workButton.setAttribute("aria-pressed", String(next === "work"));
    playButton.setAttribute("aria-pressed", String(next === "play"));
    playCtaLabel.textContent = next === "play" ? "작업으로 돌아가기" : "체험 시작";
    playCtaKey.textContent = next === "play" ? "Esc" : "Space";
    if (next === "play") {
      complete("play");
      notice(touch ? "아래 패드로 캐릭터를 움직여 보세요." : "방향키로 움직이고 Esc를 누르면 작업으로 돌아가요.", "play");
    } else {
      notice("작업 모드로 돌아왔어요.", "work");
    }
    updateHint();
  }

  function addMessage(kind: "me" | "system", text: string): void {
    const item = document.createElement("li");
    item.className = kind === "me" ? "msg msg--me msg--link" : "msg msg--system";
    item.textContent = text;
    chatLog.append(item);
    while (chatLog.children.length > 7) {
      chatLog.firstElementChild?.remove();
    }
  }

  function speak(text: string): void {
    friendSay.textContent = text;
    friendSay.hidden = false;
    sayUntil = performance.now() + 2200;
  }

  function syncInvite(): void {
    inviteButton.disabled = focus;
    inviteButton.classList.toggle("btn--primary", !focus && !game.hasFriend);
    if (focus) {
      inviteLabel.textContent = "집중 모드에서는 초대할 수 없어요";
    } else {
      inviteLabel.textContent = game.hasFriend ? "지호 돌려보내기" : "초대 링크 보내기";
    }
  }

  function sendHome(reason: string): void {
    game.dismiss();
    friendSay.hidden = true;
    addMessage("system", reason);
  }

  function setFocus(next: boolean): void {
    focus = next;
    root.dataset.focus = String(next);
    focusButton.setAttribute("aria-pressed", String(next));
    if (next) {
      setMode("work");
      if (game.hasFriend) {
        sendHome("집중 모드를 켜서 지호가 돌아갔어요.");
      }
      complete("focus");
      notice("집중 모드를 켰어요. 캐릭터가 숨고 초대도 잠시 멈춰요.");
    } else {
      notice("집중 모드를 껐어요. 캐릭터가 돌아왔어요.");
    }
    syncInvite();
    updateHint();
  }

  async function changeSkin(direction: -1 | 1): Promise<void> {
    const step = (from: Skin): Skin | undefined => SKINS[(SKINS.indexOf(from) + direction + SKINS.length) % SKINS.length];
    let next = step(skin);
    // 놀러 와 있는 친구와 같은 캐릭터는 건너뛴다.
    if (next !== undefined && game.hasFriend && next === friendSkin) {
      next = step(next);
    }
    if (next === undefined) {
      return;
    }
    try {
      await loadSkin(next);
    } catch (error) {
      console.error(error);
      notice("캐릭터를 불러오지 못했어요. 다시 눌러 주세요.");
      return;
    }
    skin = next;
    skinName.textContent = SKIN_NAMES[next];
    drawPortrait(portrait, next);
  }

  function resize(): void {
    viewport.width = root.clientWidth;
    viewport.height = root.clientHeight;
    size = viewport.width < 600 ? 72 : 96;
    renderer.resize(viewport.width, viewport.height);
    game.resize(viewport.width, viewport.height);
  }

  // 체크리스트와 친구의 말풍선은 game-core가 낸 결과만 보고 갱신한다.
  function track(world: WorldState): void {
    const host = world.players.find((player) => player.id === HOST);
    const friend = world.players.find((player) => player.id === FRIEND);
    if (host === undefined) {
      return;
    }
    if (mode === "play" && lastHost !== undefined && !done.has("move")) {
      travelled += Math.hypot(host.position.x - lastHost.x, host.position.y - lastHost.y);
      if (travelled > 60) {
        complete("move");
      }
    }
    lastHost = host.position;
    if (friend === undefined) {
      friendHitTick = null;
      return;
    }
    if (friend.lastHitTick !== friendHitTick) {
      friendHitTick = friend.lastHitTick;
      complete("hit");
      speak(friend.hp === 0 ? "항복… 3초만!" : pickLine(OUCH));
    }
    if (host.lastHitTick !== hostHitTick) {
      hostHitTick = host.lastHitTick;
      speak(host.hp === 0 ? "일어나 ㅋㅋ" : pickLine(TAUNT));
    }
  }

  function follow(element: HTMLElement, position: Vector2): void {
    const x = Math.max(96, Math.min(viewport.width - 96, position.x));
    const y = Math.max(48, position.y - size * 0.6);
    element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function frame(now: number): void {
    const alpha = game.advanceTime(now);
    const { world, previous } = game;
    const positions = new Map<string, Vector2>();
    for (const player of world.players) {
      const before = previous.find((entry) => entry.id === player.id)?.position ?? player.position;
      positions.set(player.id, {
        x: before.x + (player.position.x - before.x) * alpha,
        y: before.y + (player.position.y - before.y) * alpha,
      });
    }
    renderer.draw({
      world, previous, positions, size, alpha, now,
      skins: { [HOST]: skin, [FRIEND]: friendSkin },
      reduced: reduced.matches,
    });
    track(world);
    const host = positions.get(HOST);
    if (host !== undefined) {
      grab.style.transform = `translate(${Math.round(host.x)}px, ${Math.round(host.y)}px)`;
      follow(hint, host);
    }
    const friend = positions.get(FRIEND);
    if (friend === undefined || now > sayUntil) {
      friendSay.hidden = true;
    } else {
      follow(friendSay, friend);
    }
    raf = requestAnimationFrame(frame);
  }

  // 입력: 앱처럼 PLAY일 때만 게임 키를 받고, Ctrl·Alt·Meta 조합은 건드리지 않는다.
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyG" && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      setMode(mode === "play" ? "work" : "play");
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    const onControl = event.target instanceof Element && event.target.closest("button, a") !== null;
    if (event.code === "Space" && (mode === "play" || !onControl)) {
      event.preventDefault();
      if (!event.repeat) {
        setMode(mode === "play" ? "work" : "play");
      }
      return;
    }
    if (mode !== "play") {
      return;
    }
    if (event.code === "Escape") {
      setMode("work");
    } else if (event.code.startsWith("Arrow")) {
      event.preventDefault();
      held.add(event.code);
      sendControl();
    } else if (event.code === "KeyZ" || event.code === "KeyX") {
      sendControl(event.code === "KeyZ" ? "melee" : "stone");
    }
  });
  window.addEventListener("keyup", (event) => {
    if (held.delete(event.code)) {
      sendControl();
    }
  });
  window.addEventListener("blur", () => {
    held.clear();
    sendControl();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("#pad button")) {
    const { key, action } = button.dataset;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (key !== undefined) {
        button.setPointerCapture(event.pointerId);
        held.add(key);
        sendControl();
      } else if (action === "melee" || action === "stone") {
        sendControl(action);
      }
    });
    if (key !== undefined) {
      const release = (): void => {
        held.delete(key);
        sendControl();
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
    }
  }

  // WORK에서는 캐릭터를 잡아 끌 수 있다. 손잡이 밖의 클릭은 아래 창으로 간다.
  let dragOffset: Vector2 | undefined;
  grab.addEventListener("pointerdown", (event) => {
    const host = game.world.players.find((player) => player.id === HOST);
    if (mode !== "work" || host === undefined) {
      return;
    }
    grab.setPointerCapture(event.pointerId);
    dragOffset = { x: host.position.x - event.clientX, y: host.position.y - event.clientY };
  });
  grab.addEventListener("pointermove", (event) => {
    if (dragOffset !== undefined) {
      game.place(HOST, { x: event.clientX + dragOffset.x, y: event.clientY + dragOffset.y });
    }
  });
  const drop = (): void => {
    dragOffset = undefined;
  };
  grab.addEventListener("pointerup", drop);
  grab.addEventListener("pointercancel", drop);

  // WORK에서는 모찌가 서 있던 창과 함께 스크롤된다. 본문 위에 떠서 글을 가리지 않게 한다.
  // 화면 밖으로 밀려난 동안에는 원래 높이를 기억했다가, 되돌아오면 제자리에 세운다.
  let scrollTop = window.scrollY;
  let offscreenY: number | undefined;
  window.addEventListener("scroll", () => {
    const delta = window.scrollY - scrollTop;
    scrollTop = window.scrollY;
    const host = game.world.players.find((player) => player.id === HOST);
    if (mode !== "work" || dragOffset !== undefined || host === undefined) {
      offscreenY = undefined;
      return;
    }
    const radius = game.world.rules.playerRadius;
    const inside = (y: number): number => Math.max(radius, Math.min(viewport.height - radius, y));
    const from = offscreenY !== undefined && inside(offscreenY) === host.position.y ? offscreenY : host.position.y;
    offscreenY = from - delta;
    game.place(HOST, { x: host.position.x, y: offscreenY });
  }, { passive: true });

  workButton.addEventListener("click", () => setMode("work"));
  playButton.addEventListener("click", () => setMode("play"));
  playCta.addEventListener("click", () => setMode(mode === "play" ? "work" : "play"));
  focusButton.addEventListener("click", () => setFocus(!focus));
  need<HTMLButtonElement>("#skin-prev").addEventListener("click", () => void changeSkin(-1));
  need<HTMLButtonElement>("#skin-next").addEventListener("click", () => void changeSkin(1));
  inviteButton.addEventListener("click", () => {
    if (game.hasFriend) {
      sendHome("지호가 돌아갔어요.");
    } else {
      // 친구는 들어올 때 나와 다른 캐릭터를 고른다. 미리 불러 둔 두 종 중 하나다.
      friendSkin = skin === "mint" ? "mochi" : "mint";
      game.invite();
      addMessage("me", "초대 링크");
      addMessage("system", `지호가 ${SKIN_NAMES[friendSkin]}로 놀러 왔어요.`);
      complete("invite");
      speak("나 왔어!");
    }
    syncInvite();
    updateHint();
  });

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    if (document.hidden) {
      held.clear();
      sendControl();
    } else {
      game.resetClock();
      raf = requestAnimationFrame(frame);
    }
  });

  const timeFormat = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
  const tickClock = (): void => {
    clock.textContent = timeFormat.format(new Date());
  };
  tickClock();
  window.setInterval(tickClock, 20_000);

  resize();
  // 모찌는 문서 창 위에 올라서서 시작한다.
  const doc = need<HTMLElement>("#doc").getBoundingClientRect();
  game.place(HOST, { x: doc.right - Math.min(120, doc.width * 0.22), y: doc.top - size * 0.477 + 3 });
  drawPortrait(portrait, skin);
  updateHint();
  // 첫 장면은 바로 그린다. 말풍선이 자리 잡기 전에 보이지 않게 한다.
  frame(performance.now());
}

start().catch((error: unknown) => {
  console.error(error);
  const noticeBox = document.querySelector<HTMLElement>("#notice");
  if (noticeBox !== null) {
    noticeBox.textContent = "캐릭터를 불러오지 못했어요. 새로고침해 주세요.";
    noticeBox.dataset.show = "";
  }
});
