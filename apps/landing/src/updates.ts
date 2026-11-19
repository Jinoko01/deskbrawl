const releasesUrl = "https://api.github.com/repos/Jinoko01/deskbrawl/releases";
const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export type Update = {
  version: string;
  publishedAt: Date;
  notes: string[];
};

function readUpdate(release: unknown): Update | undefined {
  if (
    typeof release !== "object" || release === null ||
    !("draft" in release) || release.draft !== false ||
    !("prerelease" in release) || release.prerelease !== false ||
    !("tag_name" in release) || typeof release.tag_name !== "string" || !stableTag.test(release.tag_name) ||
    !("published_at" in release) || typeof release.published_at !== "string" ||
    !("body" in release) || typeof release.body !== "string"
  ) {
    return;
  }

  const publishedAt = new Date(release.published_at);
  if (Number.isNaN(publishedAt.getTime())) {
    return;
  }

  const [publicSection] = release.body.replaceAll("\r\n", "\n").trimStart()
    .split(/\n(?=#{1,6}[ \t])/, 1);
  if (!publicSection || !/^### 공지사항[ \t]*\n/.test(publicSection)) {
    return;
  }
  const notes = publicSection.split("\n").flatMap((line) => {
    const note = /^- (\S.*)$/.exec(line.trimEnd())?.[1];
    return note === undefined ? [] : [note];
  });
  if (notes.length === 0) {
    return;
  }

  return { version: release.tag_name, publishedAt, notes };
}

export async function loadUpdates(): Promise<Update[]> {
  const updates = new Map<string, Update>();
  const signal = AbortSignal.timeout(10_000);
  for (let page = 1; ; page++) {
    const response = await fetch(`${releasesUrl}?per_page=100&page=${page}`, { signal });
    if (!response.ok) {
      throw new Error(`Could not read GitHub releases (${response.status}).`);
    }
    const releases: unknown = await response.json();
    if (!Array.isArray(releases)) {
      throw new Error("Unexpected GitHub release list.");
    }
    for (const release of releases) {
      const update = readUpdate(release);
      if (update !== undefined) {
        updates.set(update.version, update);
      }
    }
    if (!response.headers.get("link")?.includes('rel="next"')) {
      return [...updates.values()].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    }
  }
}
