const repository = "Jinoko01/deskbrawl";
const macInstaller = "DeskBrawl_macOS-universal.dmg";
const stableTag = /^v\d+\.\d+\.\d+$/;

export async function loadMacDownload(): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return;
    }
    const release: unknown = await response.json();
    if (typeof release !== "object" || release === null ||
      !("draft" in release) || release.draft !== false ||
      !("prerelease" in release) || release.prerelease !== false ||
      !("tag_name" in release) || typeof release.tag_name !== "string" || !stableTag.test(release.tag_name) ||
      !("assets" in release) || !Array.isArray(release.assets)) {
      return;
    }
    const hasInstaller = release.assets.some((asset: unknown) =>
      typeof asset === "object" && asset !== null &&
      "name" in asset && asset.name === macInstaller && "state" in asset && asset.state === "uploaded");
    if (hasInstaller) {
      return `https://github.com/${repository}/releases/download/${release.tag_name}/${macInstaller}`;
    }
  } catch {
    // Keep the Mac link hidden when GitHub cannot confirm the installer.
  }
}
