# Build the Windows installer

Run **Prepare desktop release** from GitHub Actions to calculate the next version and build both installers. After the Windows and macOS builds succeed, the workflow commits the version files and changelog, pushes an annotated tag, and creates a draft release.

## Release a new version

1. Configure the Apple signing and notarization secrets before running the release workflow. [macOS release setup](macos-build.md#공개-릴리스-준비하기)
2. Open [GitHub Actions](https://github.com/Jinoko01/deskbrawl/actions), select **Prepare desktop release**, and click **Run workflow** on `main`. Choose `stable` for a public release or `alpha`, `beta`, or `rc` for testing.
3. Confirm the draft contains `DeskBrawl_x64-setup.exe` and `DeskBrawl_macOS-universal.dmg`. Check local play on both operating systems, then test a shared-server visit between two clients.
4. After approval, publish the stable draft and mark it as the latest release. Verify both website downloads while signed out. Publish test builds as prereleases so the website still offers the latest stable release.

Each stable release marked latest updates the Windows download target and the Mac link without a website redeploy. The website displays the Mac link when GitHub lists `DeskBrawl_macOS-universal.dmg` on the latest stable release. [Windows download target](https://github.com/Jinoko01/deskbrawl/releases/latest/download/DeskBrawl_x64-setup.exe)

## Publish website update notes

When a change affects players, add a plain-text bullet under `### 공지사항` in the `[Unreleased]` section of [CHANGELOG.md](../CHANGELOG.md). Write each bullet on one line in Korean and describe what players can do now or what problem they will no longer encounter. Keep build, deployment, and server maintenance details in the existing changelog sections.

The release workflow puts this section at the top of the draft. When you publish the stable release, the website reads the section from GitHub and shows it with the version and publication date. Review it in the draft before publishing, then check [the website announcements](https://www.deskbrawl.xyz/updates/). To correct an announcement or add one to an older release, edit the first section of the GitHub release. The website skips versions without public notes and test releases.

## Set a version locally

To choose a version for a local build, run this command from the repository root.

```powershell
pnpm desktop:version 1.1.0
```

Use `1.1.0-rc.1` for a release candidate. The command updates the desktop `package.json`, `tauri.conf.json`, and `Cargo.toml`, then regenerates `Cargo.lock` with Cargo. It only edits local files. If Cargo reports missing cached dependencies, fetch them with `cargo fetch --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` and retry.

## Choose the next version

Write Conventional Commits for changes to the desktop app, shared game code, and the server behavior the desktop app relies on. Public behavior includes the desktop controls and settings, invite and game behavior, and REST and Socket.IO contracts.

- `feat` increases MINOR and resets PATCH. `fix` and `security` increase PATCH.
- `!`, `BREAKING CHANGE:`, and `BREAKING-CHANGE:` increase MAJOR and reset MINOR and PATCH. Before `1.0.0`, a breaking change increases MINOR.
- `docs`, `test`, `chore`, `refactor`, and `ci` alone skip the release. Add a `Release-As: patch`, `Release-As: minor`, or `Release-As: major` footer when the subject type doesn't express the public impact. The highest applicable bump wins.

Use the commit subject to describe what changes for the user. To choose a changelog section, add a footer such as `Changelog: Security` or `Changelog: Deprecated`. You can also classify changes under `[Unreleased]` in `CHANGELOG.md`, for example when an older commit uses the wrong type. `Added` and `Deprecated` require at least MINOR, `Removed` requires MAJOR, and `Changed`, `Fixed`, and `Security` require at least PATCH. A stable release merges these notes with the qualifying commits and moves them into its version section. Prereleases leave `[Unreleased]` in place.

The first run uses the original website installer commit as the `1.0.0` baseline. After that, it calculates changes from the highest stable Git tag. A test release uses the same next version with a suffix such as `1.1.0-rc.1`.

## Recover a failed release

If `main` changed while the installer was building, the atomic push fails without creating the tag. Run the workflow again on the new `main`. The workflow needs permission to push its release commit and tag. If branch or tag rules block the push, resolve them through the repository's approved release process.

If the commit and tag were pushed but the draft was not created, run the workflow with the existing tag in `retry_tag`. It rebuilds that commit without moving the tag. If a draft already exists, review it in GitHub Releases before publishing. Use a new release for any fix to a published installer.

## Configure the multiplayer server

Build from the version you intend to release, in a fresh checkout with the [Windows prerequisites](../README.md#run-from-source) installed. Run the following commands in PowerShell at the repository root.

Use an HTTPS server origin that players can reach. For the server configured in this repository, check that `https://api.deskbrawl.xyz/health` returns `{"ok":true}` before building. Set a different origin if you operate your own server. On the server, `PUBLIC_ORIGIN` must match that origin so invite links point to the right host.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @deskbrawl/desktop network:config https://api.deskbrawl.xyz
pnpm --filter @deskbrawl/desktop tauri build --config src-tauri/tauri.network.conf.json
```

`network:config` writes `apps/desktop/.env.local` and `apps/desktop/src-tauri/tauri.network.conf.json`. It replaces existing copies in the checkout and configures both the app's server URL and Tauri's HTTP and WebSocket connection policy.

To develop against a shared LAN server, pass its reachable origin to `network:config`, then start the app with the generated configuration.

```powershell
pnpm --filter @deskbrawl/desktop tauri dev --config src-tauri/tauri.network.conf.json
```

## Package a local build

1. Find the Windows installer in `apps/desktop/src-tauri/target/release/bundle/nsis/`. The x64 build produces `DeskBrawl_<version>_x64-setup.exe`.
2. Install it on Windows 11. Check local play, then run a shared-server test with two clients by creating an invite link and joining from the second client.
3. For a manual release, create a draft at [GitHub Releases](https://github.com/Jinoko01/deskbrawl/releases) for the source tag. Upload `DeskBrawl_<version>_x64-setup.exe` as `DeskBrawl_x64-setup.exe` and the signed, notarized Mac installer from the same tag as `DeskBrawl_macOS-universal.dmg`.
4. Follow the same approval and download check as an automated release.

## Prepare an in-app update

Once the app includes the Tauri Updater, publish a `latest.json` asset alongside each signed Windows installer. The app checks GitHub's [latest release feed](https://github.com/Jinoko01/deskbrawl/releases/latest/download/latest.json). Keep the first updater release available as an installer for people on older versions. They can update in the app after installing that release.

1. Build the Windows installer with updater signing configured. Keep the signing key in the approved secret storage and use the same key for subsequent releases. The Tauri build produces the installer and a matching `.exe.sig` file. [Tauri signing guide](https://v2.tauri.app/plugin/updater/#signing-updates)
2. From the repository root, generate `latest.json` using the release tag and the path to that installer. Replace `vX.Y.Z` and the filename with the actual version.

   ```powershell
   node apps/desktop/scripts/prepare-update.mjs vX.Y.Z apps/desktop/src-tauri/target/release/bundle/nsis/DeskBrawl_X.Y.Z_x64-setup.exe
   ```

3. Upload the installer as `DeskBrawl_x64-setup.exe` and attach `latest.json` to the same draft GitHub release. The build workflow includes the manifest when the installer has a matching `.exe.sig` file. Publish the release as the latest stable release after approval.
4. On Windows 11, open the previous updater-enabled version and install the update from the app. Check that the new version opens with your saved settings. Verify that checking again reports the app is up to date.
