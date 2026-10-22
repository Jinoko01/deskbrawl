import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const idSchema = z.uuid();
export const nicknameSchema = z.string().trim().min(1).max(24);
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
  INVALID_INPUT: "입력값을 확인해 주세요.", UNAUTHORIZED: "기기 인증이 만료되었습니다. 다시 연결해 주세요.",
  INVALID_INVITE: "유효하지 않거나 만료된 방문 링크예요.", ROOM_FULL: "현재 방문 인원이 가득 찼어요.",
  HOST_OFFLINE: "호스트가 오프라인이에요.", SELF_VISIT: "자신의 공간에는 방문할 수 없어요.",
  ROOM_UNAVAILABLE: "호스트가 집중 모드여서 지금은 방문할 수 없어요.", KICKED: "호스트가 방문을 종료했어요.",
  ALREADY_VISITING: "다른 공간을 방문 중이에요. 귀환 후 다시 시도해 주세요.", SESSION_ENDED: "방문 세션이 종료되었습니다.",
  RATE_LIMITED: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.", INCOMPATIBLE_VERSION: "앱과 서버 버전이 맞지 않습니다.",
  INTERNAL_ERROR: "서버에서 요청을 처리하지 못했습니다.", CONNECTION_LOST: "서버 연결이 끊어졌습니다. 다시 연결해 주세요.",
};
export const errorSchema = z.object({ ok: z.literal(false), code: errorCodeSchema }).strict();
export const okSchema = z.object({ ok: z.literal(true) }).strict();
export const registerSchema = z.object({ nickname: nicknameSchema }).strict();
export const credentialSchema = z.object({ deviceId: idSchema, secret: tokenSchema }).strict();
export const sessionSchema = z.object({ deviceId: idSchema, accessToken: z.string().min(1).max(4096), expiresAt: tick }).strict();
export const registrationSchema = sessionSchema.extend({ secret: tokenSchema });
export const roomSchema = z.object({ id: idSchema, ownerDeviceId: idSchema, maxParticipants: z.literal(2) }).strict();
export const inviteSchema = z.object({ link: z.url(), expiresAt: tick }).strict();
export const hostSchema = z.object({ version: z.literal(PROTOCOL_VERSION), bounds: boundsSchema, focused: z.boolean().optional() }).strict();
export const joinSchema = z.object({ version: z.literal(PROTOCOL_VERSION), token: tokenSchema }).strict();
export const leaveSchema = z.object({ visitId: idSchema }).strict();
const hostControlSchema = leaveSchema.extend({ commandId: idSchema });
export const focusSchema = hostControlSchema.extend({ focused: z.boolean() });
export const kickSchema = hostControlSchema.extend({ targetPlayerId: idSchema });
export const clearVisitorsSchema = hostControlSchema;
export type RoomControl = z.infer<typeof focusSchema> | z.infer<typeof kickSchema> | z.infer<typeof clearVisitorsSchema>;
export const inputSchema = leaveSchema.extend({ seq: tick.min(1), movement: movementSchema });
export const playerActionSchema = leaveSchema.extend({ actionId: idSchema, action: actionSchema });
const positive = z.number().finite().positive().max(100_000);
const combat = z.object({ meleeReach: positive, meleeCooldownMs: positive, stoneCooldownMs: positive,
  stoneSpeedUnitsPerSecond: positive, stoneRadius: positive, stoneLifetimeMs: positive,
  stunMs: positive, invulnerabilityMs: positive, knockbackMs: positive, knockbackSpeedUnitsPerSecond: positive, effectMs: positive }).strict();
const player = z.object({ id: idSchema, position: vector, facing: vector, knockbackVelocity: vector,
  knockbackUntilTick: tick, stunnedUntilTick: tick, invulnerableUntilTick: tick, meleeReadyAtTick: tick, stoneReadyAtTick: tick,
  lastAction: z.object({ kind: actionSchema, tick }).strict().nullable(), lastHitTick: tick.nullable() }).strict();
const projectile = z.object({ id: z.string().max(160), ownerId: idSchema, position: vector, velocity: vector, expiresAtTick: tick }).strict();
const effect = z.object({ id: z.string().max(200), kind: z.enum(["impact", "dust"]), position: vector, startedAtTick: tick, expiresAtTick: tick }).strict();
export const worldSchema = z.object({ tick, bounds: boundsSchema,
  rules: z.object({ tickMs: positive, moveSpeedUnitsPerSecond: positive, playerRadius: positive, combat: combat.optional() }).strict(),
  players: z.array(player).max(2), projectiles: z.array(projectile).max(32), effects: z.array(effect).max(64) }).strict();
export const memberSchema = z.object({ playerId: idSchema, nickname: nicknameSchema, role: z.enum(["host", "guest"]) }).strict();
export const snapshotSchema = z.object({ version: z.literal(PROTOCOL_VERSION), roomId: idSchema, worldId: idSchema,
  world: worldSchema, members: z.array(memberSchema).max(2), lastProcessedSeq: z.record(idSchema, tick) }).strict();
export const joinedSchema = z.object({ ok: z.literal(true), roomId: idSchema, worldId: idSchema, visitId: idSchema,
  playerId: idSchema, role: z.enum(["host", "guest"]), snapshot: snapshotSchema }).strict();
export const joinedAckSchema = z.union([joinedSchema, errorSchema]);
export const commandAckSchema = z.union([okSchema, errorSchema]);
export const bridgeSchema = z.object({ mode: z.enum(["local", "host", "guest", "offline"]), snapshot: snapshotSchema.nullable() }).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Joined = z.infer<typeof joinedSchema>;
export type Input = z.infer<typeof inputSchema>;
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
