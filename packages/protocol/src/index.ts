import { z } from "zod";

export const PROTOCOL_VERSION = 2;
export const idSchema = z.uuid();
export const nicknameSchema = z.string().trim().min(1).max(12);
export const characterSkinSchema = z.enum(["mochi", "mint", "sunny", "coral", "lumi", "rusty", "byte", "berry"]);
export type CharacterSkin = z.infer<typeof characterSkinSchema>;
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const tick = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().finite().min(-100_000).max(100_000);
const vector = z.object({ x: coordinate, y: coordinate }).strict();
export const boundsSchema = z.object({ width: z.number().min(320).max(16384), height: z.number().min(200).max(16384) }).strict();
export const movementSchema = z.object({ x: z.union([z.literal(-1), z.literal(0), z.literal(1)]), y: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).strict();
export const actionSchema = z.enum(["melee", "stone"]);
export const errorCodeSchema = z.enum(["INVALID_INPUT", "UNAUTHORIZED", "INVALID_INVITE", "ROOM_FULL", "HOST_OFFLINE", "ROOM_UNAVAILABLE", "KICKED", "SELF_VISIT", "ALREADY_VISITING", "SESSION_ENDED", "RATE_LIMITED", "INCOMPATIBLE_VERSION", "INTERNAL_ERROR", "CONNECTION_LOST"]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_INPUT: "입력값을 처리하지 못했어요. 닉네임과 방문 링크를 확인해 주세요.",
  UNAUTHORIZED: "기기를 인증하지 못했어요. 내 공간에 다시 연결해 주세요.",
  INVALID_INVITE: "사용할 수 없는 방문 링크예요. 친구에게 새 링크를 요청해 주세요.",
  ROOM_FULL: "방문 인원이 가득 찼어요. 자리가 생기면 다시 방문해 주세요.",
  HOST_OFFLINE: "친구의 공간이 닫혀 있어요. 친구가 공간을 열면 방문해 주세요.",
  SELF_VISIT: "내 공간의 링크예요. 방문하려면 친구의 링크를 붙여넣어 주세요.",
  ROOM_UNAVAILABLE: "친구가 집중 모드예요. 친구가 집중 모드를 끄면 방문해 주세요.",
  KICKED: "친구가 방문을 종료했어요.",
  ALREADY_VISITING: "다른 공간을 방문 중이에요. 내 공간으로 돌아온 뒤 다시 방문해 주세요.",
  SESSION_ENDED: "친구 공간 방문이 끝났어요.",
  RATE_LIMITED: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  INCOMPATIBLE_VERSION: "현재 앱 버전으로 연결할 수 없어요. 앱을 업데이트한 뒤 다시 연결해 주세요.",
  INTERNAL_ERROR: "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
  CONNECTION_LOST: "연결이 끊겼어요. 인터넷 연결을 확인하고 다시 연결해 주세요.",
};
export const errorSchema = z.object({ ok: z.literal(false), code: errorCodeSchema }).strict();
export const okSchema = z.object({ ok: z.literal(true) }).strict();
export const registerSchema = z.object({ nickname: nicknameSchema }).strict();
export const credentialSchema = z.object({ deviceId: idSchema, secret: tokenSchema }).strict();
export const sessionSchema = z.object({ deviceId: idSchema, accessToken: z.string().min(1).max(4096), expiresAt: tick }).strict();
export const SESSION_REFRESH_READY_EVENT = "session:refresh-ready";
export const SESSION_REFRESH_EVENT = "session:refresh";
export const sessionRefreshSchema = sessionSchema.pick({ accessToken: true });
export const registrationSchema = sessionSchema.extend({ secret: tokenSchema });
export const roomSchema = z.object({ id: idSchema, ownerDeviceId: idSchema, maxParticipants: z.literal(6) }).strict();
export const inviteSchema = z.object({ link: z.url(), expiresAt: tick }).strict();
export const hostSchema = z.object({ version: z.literal(PROTOCOL_VERSION), bounds: boundsSchema, focused: z.boolean().optional() }).strict();
export const joinSchema = z.object({ version: z.literal(PROTOCOL_VERSION), token: tokenSchema }).strict();
export const resumeSchema = z.object({ version: z.literal(PROTOCOL_VERSION), visitId: idSchema, resumeToken: tokenSchema }).strict();
export const leaveSchema = z.object({ visitId: idSchema }).strict();
export const playerProfileSchema = leaveSchema.extend({ nickname: nicknameSchema.optional(), skin: characterSkinSchema.optional() })
  .refine((value) => value.nickname !== undefined || value.skin !== undefined);
export type PlayerProfile = Pick<z.infer<typeof playerProfileSchema>, "nickname" | "skin">;
// Skins travel in a separate event so existing v2 clients keep their strict snapshot contract.
export const roomProfilesSchema = z.object({ roomId: idSchema, worldId: idSchema,
  profiles: z.array(z.object({ playerId: idSchema, skin: characterSkinSchema }).strict()).max(6) }).strict();
const hostControlSchema = leaveSchema.extend({ commandId: idSchema });
export const focusSchema = hostControlSchema.extend({ focused: z.boolean() });
export const kickSchema = hostControlSchema.extend({ targetPlayerId: idSchema });
export const clearVisitorsSchema = hostControlSchema;
export type RoomControl = z.infer<typeof focusSchema> | z.infer<typeof kickSchema> | z.infer<typeof clearVisitorsSchema>;
export const inputSchema = leaveSchema.extend({ seq: tick.min(1), movement: movementSchema });
export const playerChatSchema = leaveSchema.extend({ seq: tick.min(1), current: z.string().max(50), previous: z.string().max(50) });
export const chatSchema = z.object({ playerId: idSchema, current: z.string().max(50), previous: z.string().max(50), updatedAt: tick }).strict();
export const playerActionSchema = leaveSchema.extend({ actionId: idSchema, action: actionSchema });
export const playerModeSchema = leaveSchema.extend({ seq: tick.min(1), playing: z.boolean() });
export const playerPositionSchema = leaveSchema.extend({ seq: tick.min(1), position: vector });
export const serverFeaturesSchema = z.object({ workDrag: z.literal(true) }).strict();
// Optional Socket.IO handshake auth flags beside version/token. Servers ignore unknown flags, so a new client
// still works with an old server. idleSnapshots: the client tolerates skipped snapshots while nothing changes.
export const socketCapabilitiesSchema = z.object({ health: z.boolean().optional(), idleSnapshots: z.boolean().optional() });
const positive = z.number().finite().positive().max(100_000);
const combat = z.object({ meleeReach: positive, meleeCooldownMs: positive, stoneCooldownMs: positive,
  stoneSpeedUnitsPerSecond: positive, stoneRadius: positive, stoneLifetimeMs: positive,
  stunMs: positive, invulnerabilityMs: positive, knockbackMs: positive, knockbackSpeedUnitsPerSecond: positive, effectMs: positive }).strict();
// HP is negotiated in the Socket.IO handshake; older v2 servers may omit it.
const player = z.object({ id: idSchema, hp: z.number().int().min(0).max(50).optional(), position: vector, facing: vector, knockbackVelocity: vector,
  knockbackUntilTick: tick, stunnedUntilTick: tick, invulnerableUntilTick: tick, meleeReadyAtTick: tick, stoneReadyAtTick: tick,
  lastAction: z.object({ kind: actionSchema, tick }).strict().nullable(), lastHitTick: tick.nullable() }).strict();
const projectile = z.object({ id: z.string().max(160), ownerId: idSchema, position: vector, velocity: vector, expiresAtTick: tick }).strict();
const effect = z.object({ id: z.string().max(200), kind: z.enum(["impact", "dust"]), position: vector, startedAtTick: tick, expiresAtTick: tick }).strict();
export const worldSchema = z.object({ tick, bounds: boundsSchema,
  rules: z.object({ tickMs: positive, moveSpeedUnitsPerSecond: positive, playerRadius: positive, combat: combat.optional() }).strict(),
  players: z.array(player).max(6), projectiles: z.array(projectile).max(32), effects: z.array(effect).max(64) }).strict();
// Existing devices may still have nicknames saved under the previous 24-character limit.
export const memberSchema = z.object({ playerId: idSchema, nickname: z.string().trim().min(1).max(24), role: z.enum(["host", "guest"]), skin: characterSkinSchema.optional() }).strict();
export const snapshotSchema = z.object({ version: z.literal(PROTOCOL_VERSION), roomId: idSchema, worldId: idSchema,
  world: worldSchema, chats: z.array(chatSchema).max(6).default([]), members: z.array(memberSchema).max(6), lastProcessedSeq: z.record(idSchema, tick) }).strict();
export const joinedSchema = z.object({ ok: z.literal(true), roomId: idSchema, worldId: idSchema, visitId: idSchema,
  playerId: idSchema, resumeToken: tokenSchema, role: z.enum(["host", "guest"]), snapshot: snapshotSchema }).strict();
export const joinedAckSchema = z.union([joinedSchema, errorSchema]);
export const commandAckSchema = z.union([okSchema, errorSchema]);
export const bridgeSchema = z.object({ mode: z.enum(["local", "host", "guest", "recovering", "offline"]), snapshot: snapshotSchema.nullable(), playerId: idSchema.optional() }).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Joined = z.infer<typeof joinedSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Chat = z.infer<typeof playerChatSchema>;
export type Action = z.infer<typeof playerActionSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Bridge = z.infer<typeof bridgeSchema>;

// 초대 URL은 설정된 서버의 주소만 허용한다. 외부 URL로 인증 정보를 보내지 않는다.
export function parseInviteLink(raw: string, serverOrigin: string): string {
  if (raw.length > 2048) throw new Error("INVALID_INVITE");
  const url = new URL(raw);
  if (url.search || url.hash || url.username || url.password || url.port && url.protocol === "deskbrawl:") throw new Error("INVALID_INVITE");
  const app = url.protocol === "deskbrawl:" && url.hostname === "join";
  const web = url.origin === new URL(serverOrigin).origin && /^\/join\//.test(url.pathname);
  if (!app && !web) throw new Error("INVALID_INVITE");
  return tokenSchema.parse(app ? url.pathname.slice(1) : url.pathname.slice(6));
}
