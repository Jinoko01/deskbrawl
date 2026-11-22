import { afterEach, expect, test, vi } from "vitest";
import { loadMacDownload } from "./downloads";

afterEach(() => vi.unstubAllGlobals());

const macAsset = { name: "DeskBrawl_macOS-universal.dmg", state: "uploaded" };
const stableRelease = { tag_name: "v1.2.0", draft: false, prerelease: false, assets: [macAsset] };

test("links to the verified DMG in the published release", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(stableRelease)));
  await expect(loadMacDownload()).resolves.toBe("https://github.com/Jinoko01/deskbrawl/releases/download/v1.2.0/DeskBrawl_macOS-universal.dmg");
});

test("omits the link for an unavailable DMG or an unpublished release", async () => {
  const fetchRelease = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...stableRelease, assets: [] }))
    .mockResolvedValueOnce(Response.json({ ...stableRelease, assets: [{ ...macAsset, state: "starter" }] }))
    .mockResolvedValueOnce(Response.json({ ...stableRelease, draft: true }))
    .mockResolvedValueOnce(Response.json({ ...stableRelease, prerelease: true }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockRejectedValueOnce(new Error("Offline"));
  vi.stubGlobal("fetch", fetchRelease);

  for (let check = 0; check < 6; check++) {
    await expect(loadMacDownload()).resolves.toBeUndefined();
  }
});
