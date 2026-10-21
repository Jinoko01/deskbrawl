import { readFile, writeFile } from "node:fs/promises";

const raw = process.argv[2];
if (!raw) throw new Error("Usage: pnpm network:config http://192.168.x.x:3000");
const url = new URL(raw);
if (!["http:", "https:"].includes(url.protocol) || url.origin !== raw || url.username || url.password) throw new Error("Provide one HTTP(S) origin without a path");
const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const websocket = raw.replace(/^http/, "ws");
const update = (policy) => policy.replace(/connect-src [^;]+/, `connect-src 'self' ipc: http://ipc.localhost ws://127.0.0.1:1420 ${raw} ${websocket}`);
await writeFile(new URL("../.env.local", import.meta.url), `VITE_SERVER_URL=${raw}\n`);
await writeFile(new URL("../src-tauri/tauri.network.conf.json", import.meta.url), JSON.stringify({ app: { security: { csp: update(config.app.security.csp), devCsp: update(config.app.security.devCsp) } } }, null, 2) + "\n");
console.log("Network origin configured. Start Tauri with --config src-tauri/tauri.network.conf.json");
