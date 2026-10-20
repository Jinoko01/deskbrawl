/* Asset review only: no framework, server, network or game state. */
(() => {
  "use strict";
  const status = document.getElementById("status");
  const data = window.DESKBRAWL_ASSETS;
  if (!data) {
    status.textContent = "에셋 목록을 찾을 수 없습니다. tools/build-atlases.ps1을 실행한 뒤 다시 여세요.";
    return;
  }
  const motion = document.getElementById("motion");
  const size = document.getElementById("size");
  const play = document.getElementById("play");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const images = new Map();
  const cards = [];
  let playing = !reducedMotion.matches;
  let elapsedMs = 0;
  let previousTime = null;
  const frameDurationMs = { idle: 220, walk: 120, melee: 100, throw: 150, hit: 220 };

  function syncPlayButton() {
    play.textContent = playing ? "일시 정지" : "재생";
    play.setAttribute("aria-pressed", String(playing));
  }

  function addCard(containerId, sheetId, name, description, animation, frameName) {
    const card = document.createElement("article");
    card.className = "card";
    const stage = document.createElement("div");
    stage.className = "stage";
    const canvas = document.createElement("canvas");
    canvas.width = 144;
    canvas.height = 144;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${name} 픽셀 스프라이트 미리보기`);
    stage.append(canvas);
    const caption = document.createElement("div");
    caption.className = "caption";
    const title = document.createElement("h3");
    title.className = "name";
    title.textContent = name;
    const detail = document.createElement("p");
    detail.className = "description";
    detail.textContent = description;
    const links = document.createElement("div");
    links.className = "links";
    for (const [label, path] of [["PNG 시트", data.sheets[sheetId].image], ["Atlas JSON", data.sheets[sheetId].image.replace(/\.png$/, ".json")]]) {
      const link = document.createElement("a");
      link.textContent = label;
      link.href = path;
      links.append(link);
    }
    caption.append(title, detail, links);
    card.append(stage, caption);
    document.getElementById(containerId).append(card);
    cards.push({ sheetId, canvas, animation, frameName });
  }

  for (const character of data.characters) {
    addCard("characters", character.id, character.name, character.description, "character");
  }
  const weapons = [
    ["squeaky-hammer", "삑삑 망치"], ["foam-baton", "폼 배트"],
    ["practice-sword", "연습용 목검"], ["rubber-chicken", "고무 닭"],
    ["foam-glove", "장난감 글러브"], ["fly-swatter", "파리채"],
    ["paper-roll", "종이 뭉치"], ["soft-mallet", "푹신한 망치"],
  ];
  for (const [id, name] of weapons) addCard("weapons", "props", name, "독립 소품 · 장착 위치 조정 필요", null, id);
  addCard("effects", "props", "회색 돌", "회전 · 4프레임", "stone-gray");
  addCard("effects", "props", "갈색 돌", "회전 · 4프레임", "stone-brown");
  for (const [id, name] of [["swoosh", "스윙"], ["impact", "타격"], ["stun", "기절"], ["dust", "착지 먼지"]]) {
    addCard("effects", "effects", name, "독립 이펙트 · 4프레임", id);
  }

  const loading = Object.entries(data.sheets).map(([id, sheet]) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => { images.set(id, image); resolve(null); };
    image.onerror = () => resolve(sheet.image);
    image.src = sheet.image;
  }));
  Promise.all(loading).then((failures) => {
    const failed = failures.filter(Boolean);
    status.textContent = failed.length
      ? `불러오기 실패: ${failed.join(", ")}. 파일 경로를 확인한 뒤 새로고침하세요.`
      : "PNG 10장 로드 완료 · 캐릭터 8종 / 무기 8종 / 돌 2종 / 이펙트 4종";
  });

  play.addEventListener("click", () => { playing = !playing; syncPlayButton(); });
  document.getElementById("step").addEventListener("click", () => {
    playing = false;
    elapsedMs += frameDurationMs[motion.value];
    syncPlayButton();
  });
  motion.addEventListener("change", () => { elapsedMs = 0; });
  document.getElementById("background").addEventListener("change", (event) => {
    document.body.classList.toggle("light", event.target.value === "light");
  });
  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) { playing = false; syncPlayButton(); }
  });
  document.addEventListener("visibilitychange", () => { previousTime = null; });
  syncPlayButton();

  function render(time) {
    if (previousTime !== null && playing && !document.hidden) elapsedMs += Math.min(time - previousTime, 100);
    previousTime = time;
    for (const card of cards) {
      const context = card.canvas.getContext("2d");
      context.clearRect(0, 0, 144, 144);
      const image = images.get(card.sheetId);
      if (!image) continue;
      const atlas = data.sheets[card.sheetId].atlas;
      const animation = card.animation === "character" ? motion.value : card.animation;
      const names = card.frameName ? [card.frameName] : atlas.animations[animation];
      const durationMs = frameDurationMs[animation] ?? 150;
      const frameName = names[Math.floor(elapsedMs / durationMs) % names.length];
      const frame = atlas.frames[frameName];
      const rectangle = frame.frame;
      const placement = frame.spriteSourceSize;
      const displaySize = Number(size.value);
      const scale = displaySize / frame.sourceSize.w;
      const margin = (144 - displaySize) / 2;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, rectangle.x, rectangle.y, rectangle.w, rectangle.h,
        Math.round(margin + placement.x * scale), Math.round(margin + placement.y * scale),
        Math.round(placement.w * scale), Math.round(placement.h * scale));
    }
    window.requestAnimationFrame(render);
  }
  window.requestAnimationFrame(render);
})();
