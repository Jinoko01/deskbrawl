import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { boundsSchema, bridgeSchema, credentialSchema } from "@deskbrawl/protocol";
import type { Bridge, Credential } from "@deskbrawl/protocol";

export async function readCredential(origin: string): Promise<Credential | undefined> {
  if (!isTauri()) return;
  const raw = await invoke<unknown>("credential_read");
  if (raw === null) return;
  if (typeof raw !== "string") throw new Error("INVALID_CREDENTIAL");
  const records: unknown = JSON.parse(raw);
  if (typeof records !== "object" || records === null) throw new Error("INVALID_CREDENTIAL");
  const entry: unknown = Object.getOwnPropertyDescriptor(records, origin)?.value;
  return entry === undefined ? undefined : credentialSchema.parse(entry);
}
export async function storeCredential(origin: string, credential: Credential): Promise<void> {
  if (!isTauri()) return;
  const raw = await invoke<unknown>("credential_read");
  const records: Record<string, Credential> = {};
  if (raw !== null) {
    if (typeof raw !== "string") throw new Error("INVALID_CREDENTIAL");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("INVALID_CREDENTIAL");
    for (const [key, entry] of Object.entries(parsed)) records[key] = credentialSchema.parse(entry);
  }
  records[origin] = credentialSchema.parse(credential);
  await invoke("credential_write", { credential: JSON.stringify(records) });
}
export async function hostBounds() {
  if (!isTauri()) return { width: 1280, height: 720 };
  const value = await invoke<unknown>("network_bounds");
  if (!Array.isArray(value) || value.length !== 2) throw new Error("INVALID_BOUNDS");
  return boundsSchema.parse({ width: value[0], height: value[1] });
}
export async function publishNetwork(state: Bridge): Promise<void> {
  if (isTauri()) await invoke("network_publish", bridgeSchema.parse(state));
}
export async function watchNetwork(onState: (state: Bridge) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  let revision = 0;
  const receive = (value: unknown) => {
    if (typeof value !== "string") throw new Error("INVALID_NETWORK_STATE");
    onState(bridgeSchema.parse(JSON.parse(value)));
  };
  const stop = await listen<unknown>("network-world", ({ payload }) => { revision++; receive(payload); });
  try {
    const current = await invoke<unknown>("network_read");
    if (revision === 0) receive(current);
    return stop;
  } catch (error) { stop(); throw error; }
}
export async function watchInvites(onLink: (link: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  let received = false;
  const stop = await onOpenUrl((urls) => { received = true; for (const url of urls) onLink(url); });
  try {
    const current = await getCurrent();
    if (!received) for (const url of current ?? []) onLink(url);
    return stop;
  } catch (error) { stop(); throw error; }
}
