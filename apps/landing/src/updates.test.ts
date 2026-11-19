import { afterEach, expect, test, vi } from "vitest";
import { loadUpdates } from "./updates";

afterEach(() => {
  vi.unstubAllGlobals();
});

const publicBody = "### 공지사항\r\n\r\n- 연습용 샌드백을 켜거나 끌 수 있어요.\r\n\r\n### Changed\r\n\r\n- tune server metrics";
const release = {
  draft: false,
  prerelease: false,
  tag_name: "v1.1.0",
  published_at: "2026-11-17T15:30:00Z",
  body: publicBody,
};

test("shows public notes from published stable releases across pages, newest first", async () => {
  const fetchReleases = vi.fn()
    .mockResolvedValueOnce(Response.json([
      release,
      { ...release, tag_name: "v1.2.0", draft: true },
      { ...release, tag_name: "v1.0.0-rc.1", prerelease: true },
      { ...release, tag_name: "v1.0.1-beta.1" },
      { ...release, tag_name: "v1.0.2", published_at: null },
      { ...release, tag_name: "v1.0.3", body: "### Fixed\n\n- tune server metrics" },
      { ...release, tag_name: "v1.0.4", body: "### 공지사항\n\n### Fixed\n\n- internal work" },
      { ...release, tag_name: "v1.0.5", body: "```md\n### 공지사항\n- an internal example\n```" },
    ], { headers: { link: '<https://api.github.com/example?page=2>; rel="next"' } }))
    .mockResolvedValueOnce(Response.json([
      release,
      { ...release, tag_name: "v1.1.1", published_at: "2026-11-18T15:30:00Z", body: "### 공지사항\n\n- 접속 문제를 고쳤어요." },
    ]));
  vi.stubGlobal("fetch", fetchReleases);

  await expect(loadUpdates()).resolves.toEqual([
    { version: "v1.1.1", publishedAt: new Date("2026-11-18T15:30:00Z"), notes: ["접속 문제를 고쳤어요."] },
    { version: "v1.1.0", publishedAt: new Date("2026-11-17T15:30:00Z"), notes: ["연습용 샌드백을 켜거나 끌 수 있어요."] },
  ]);
  expect(fetchReleases).toHaveBeenCalledTimes(2);
  expect(fetchReleases.mock.calls[1]?.[0]).toContain("page=2");
});

test("reports a failed request separately from an empty release list", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response(null, { status: 403 })));

  await expect(loadUpdates()).resolves.toEqual([]);
  await expect(loadUpdates()).rejects.toThrow("(403)");
});
