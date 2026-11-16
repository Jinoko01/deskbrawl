# Build the Windows installer

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

## Prepare the GitHub release

1. Find the Windows installer in `apps/desktop/src-tauri/target/release/bundle/nsis/`. The x64 build produces `DeskBrawl_<version>_x64-setup.exe`.
2. Install it on Windows 11. Check local play, then run a shared-server test with two clients by creating an invite link and joining from the second client.
3. Create a draft at [GitHub Releases](https://github.com/Jinoko01/deskbrawl/releases). Select the tag for the source version you built and upload the `-setup.exe` file as a release asset.
4. After approval, publish the release and verify that the installer downloads from **Assets** while signed out.
