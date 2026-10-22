import {
  credentialSchema,
  errorSchema,
  ERROR_MESSAGES,
  inviteSchema,
  okSchema,
  registrationSchema,
  roomSchema,
  sessionSchema,
} from "@deskbrawl/protocol";
import type { Credential, Session } from "@deskbrawl/protocol";

export const SERVER_ORIGIN = String(import.meta.env.VITE_SERVER_URL ?? "http://127.0.0.1:3000");
const url = new URL(SERVER_ORIGIN);
if (url.origin !== SERVER_ORIGIN || !["http:", "https:"].includes(url.protocol)) {
  throw new Error("Invalid VITE_SERVER_URL");
}

async function request(path: string, method: string, token?: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal === undefined ? AbortSignal.timeout(8000) : AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  }).catch((error: unknown) => {
    if (signal?.aborted) {
      throw error;
    }
    throw new Error("서버에 연결하지 못했습니다. 서버 실행 상태와 주소를 확인해 주세요.");
  });
  if (response.status === 503) {
    throw new Error("서버가 준비되지 않았어요. 서버의 PostgreSQL 실행 상태를 확인한 뒤 다시 연결해 주세요.");
  }
  const json: unknown = await response.json().catch(() => {
    throw new Error("서버 응답 형식이 올바르지 않습니다.");
  });
  if (!response.ok) {
    const error = errorSchema.safeParse(json);
    throw new Error(error.success ? ERROR_MESSAGES[error.data.code] : "서버 요청에 실패했습니다.");
  }
  return json;
}
export async function registerDevice(nickname: string, signal: AbortSignal) {
  return registrationSchema.parse(await request("/v1/devices", "POST", undefined, { nickname }, signal));
}
export async function restoreDevice(credential: Credential, signal: AbortSignal): Promise<Session> {
  return sessionSchema.parse(await request("/v1/devices/session", "POST", undefined, credentialSchema.parse(credential), signal));
}
export async function getRoom(session: Session, signal: AbortSignal) {
  return roomSchema.parse(await request("/v1/rooms/me", "GET", session.accessToken, undefined, signal));
}
export async function rotateInvite(session: Session) {
  return inviteSchema.parse(await request("/v1/rooms/me/invites", "POST", session.accessToken));
}
export async function revokeInvite(session: Session) {
  return okSchema.parse(await request("/v1/rooms/me/invites/current", "DELETE", session.accessToken));
}
