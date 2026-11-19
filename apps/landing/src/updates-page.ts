import { loadUpdates } from "./updates";
import type { Update } from "./updates";

const formatDate = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" });

function renderUpdate(update: Update): HTMLElement {
  const article = document.createElement("article");
  article.className = "updates__entry";
  article.id = update.version;

  const header = document.createElement("header");
  const version = document.createElement("h2");
  version.textContent = update.version;
  const time = document.createElement("time");
  time.dateTime = update.publishedAt.toISOString();
  time.textContent = formatDate.format(update.publishedAt);
  header.append(version, time);

  const notes = document.createElement("ul");
  for (const note of update.notes) {
    const item = document.createElement("li");
    item.textContent = note;
    notes.append(item);
  }
  article.append(header, notes);
  return article;
}

const title = document.getElementById("updates-title");
const status = document.getElementById("updates-status");
const list = document.getElementById("updates-list");
const retry = document.getElementById("updates-retry");

if (title && status && list && retry instanceof HTMLButtonElement) {
  const load = async () => {
    const retryHadFocus = document.activeElement === retry;
    retry.disabled = true;
    status.textContent = "업데이트 소식을 불러오는 중이에요.";

    try {
      const updates = await loadUpdates();
      list.replaceChildren(...updates.map(renderUpdate));
      status.textContent = updates.length ? "" : "아직 공개된 업데이트 소식이 없어요.";
      if (retryHadFocus && (document.activeElement === retry || document.activeElement === document.body)) {
        title.focus();
      }
      retry.hidden = true;
    } catch {
      status.textContent = "업데이트 소식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
      retry.hidden = false;
    } finally {
      retry.disabled = false;
      if (!retry.hidden && retryHadFocus && document.activeElement === document.body) {
        retry.focus();
      }
    }
  };

  retry.addEventListener("click", () => void load());
  void load();
}
