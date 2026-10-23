import { describe, expect, it } from "vitest";
import { characterSkinSchema, playerProfileSchema, roomProfilesSchema } from "./index";
import { chatSchema, playerChatSchema, bridgeSchema, resumeSchema, roomSchema, snapshotSchema, worldSchema, clearVisitorsSchema, focusSchema, hostSchema, inputSchema, joinSchema, kickSchema, parseInviteLink, playerActionSchema } from "./index";

const token = "a".repeat(43);
const visitId = "123e4567-e89b-42d3-a456-426614174000";

it("validates profile edits and room-scoped character selections", () => {
  expect(characterSkinSchema.options).toHaveLength(8);
  for (const skin of characterSkinSchema.options) {
    expect(playerProfileSchema.parse({ visitId, skin }).skin).toBe(skin);
  }
  expect(playerProfileSchema.parse({ visitId, nickname: " 새 이름 ", skin: "mint" }).nickname).toBe("새 이름");
  for (const body of [
    { visitId }, { visitId, nickname: " " }, { visitId, nickname: "x".repeat(25) },
    { visitId, skin: "other" }, { visitId, skin: "mochi", playerId: visitId },
  ]) {
    expect(playerProfileSchema.safeParse(body).success).toBe(false);
  }
  const profiles = { roomId: visitId, worldId: visitId, profiles: [{ playerId: visitId, skin: "mint" }] };
  expect(roomProfilesSchema.parse(profiles)).toEqual(profiles);
  expect(roomProfilesSchema.safeParse({ ...profiles, profiles: Array.from({ length: 7 }, () => profiles.profiles[0]) }).success).toBe(false);
});
describe("M2 trust boundaries", () => {
  it("accepts app and configured web links and rejects alternate origins or URL extras", () => {
    expect(parseInviteLink(`deskbrawl://join/${token}`, "http://127.0.0.1:3000")).toBe(token);
    expect(parseInviteLink(`https://game.example/join/${token}`, "https://game.example")).toBe(token);
    for (const raw of [`https://evil.example/join/${token}`, `deskbrawl://join/${token}?redirect=evil`, `deskbrawl://join/${token}#x`, `deskbrawl://other/${token}`, `deskbrawl://join/${token}/`, `deskbrawl://join:80/${token}`]) {
      expect(() => parseInviteLink(raw, "https://game.example")).toThrow();
    }
  });
  it("bounds inputs and rejects coordinates, old protocols, and unauthorized fields", () => {
    expect(inputSchema.parse({ visitId, seq: 1, movement: { x: -1, y: 0 } }).seq).toBe(1);
    for (const seq of [0, -1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(inputSchema.safeParse({ visitId, seq, movement: { x: 0, y: 0 } }).success).toBe(false);
    expect(inputSchema.safeParse({ visitId, seq: 1, movement: { x: 2, y: 0 } }).success).toBe(false);
    expect(inputSchema.safeParse({ visitId, seq: 1, movement: { x: 0, y: 0 }, position: { x: 900, y: 0 } }).success).toBe(false);
    expect(joinSchema.safeParse({ version: 0, token }).success).toBe(false);
    expect(hostSchema.safeParse({ version: 2, bounds: { width: 1e9, height: 720 } }).success).toBe(false);
    expect(playerActionSchema.safeParse({ visitId, actionId: visitId, action: "stone", targetId: visitId }).success).toBe(false);
  });
});

describe("M3 host controls", () => {
  it("requires a session and command ID, a boolean focus value, and a validated kick target", () => {
    const control = { visitId, commandId: visitId };
    expect(focusSchema.parse({ ...control, focused: true }).focused).toBe(true);
    expect(kickSchema.parse({ ...control, targetPlayerId: visitId }).targetPlayerId).toBe(visitId);
    expect(clearVisitorsSchema.parse(control)).toEqual(control);
    expect(focusSchema.safeParse({ ...control, focused: "true" }).success).toBe(false);
    expect(focusSchema.safeParse({ visitId, focused: true }).success).toBe(false);
    expect(kickSchema.safeParse({ ...control, targetPlayerId: "nickname" }).success).toBe(false);
    expect(clearVisitorsSchema.safeParse({ ...control, hostId: visitId }).success).toBe(false);
    expect(hostSchema.parse({ version: 2, bounds: { width: 1280, height: 720 } }).focused).toBeUndefined();
  });
});


describe("M4 recovery and capacity contracts", () => {
  it("requires the version, session ID and opaque resume token without extra fields", () => {
    expect(resumeSchema.parse({ version: 2, visitId, resumeToken: token }).visitId).toBe(visitId);
    for (const body of [
      { version: 1, visitId, resumeToken: token },
      { version: 2, visitId, resumeToken: "short" },
      { version: 2, visitId, resumeToken: token, deviceId: visitId },
    ]) expect(resumeSchema.safeParse(body).success).toBe(false);
    expect(roomSchema.parse({ id: visitId, ownerDeviceId: visitId, maxParticipants: 6 }).maxParticipants).toBe(6);
    expect(roomSchema.safeParse({ id: visitId, ownerDeviceId: visitId, maxParticipants: 2 }).success).toBe(false);
    expect(bridgeSchema.parse({ mode: "recovering", snapshot: null }).mode).toBe("recovering");
    const player = { id: visitId, position: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, knockbackVelocity: { x: 0, y: 0 }, knockbackUntilTick: 0, stunnedUntilTick: 0, invulnerableUntilTick: 0, meleeReadyAtTick: 0, stoneReadyAtTick: 0, lastAction: null, lastHitTick: null };
    expect(worldSchema.shape.players.safeParse(Array.from({ length: 6 }, () => player)).success).toBe(true);
    expect(worldSchema.shape.players.safeParse(Array.from({ length: 7 }, () => player)).success).toBe(false);
    expect(snapshotSchema.shape.chats.parse(undefined)).toEqual([]);
  });
});


it("validates ephemeral two-line chats without allowing another sender or unbounded content", () => {
  const chat = { visitId, seq: 1, current: "한글 입력 중", previous: "이전 말풍선" };
  expect(playerChatSchema.parse(chat)).toEqual(chat);
  expect(playerChatSchema.safeParse({ ...chat, current: "x".repeat(51) }).success).toBe(false);
  expect(playerChatSchema.safeParse({ ...chat, previous: "x".repeat(51) }).success).toBe(false);
  expect(playerChatSchema.safeParse({ ...chat, seq: 0 }).success).toBe(false);
  expect(playerChatSchema.safeParse({ ...chat, playerId: visitId }).success).toBe(false);
  expect(chatSchema.safeParse({ playerId: visitId, current: "", previous: "", updatedAt: -1 }).success).toBe(false);
});

it("accepts negotiated HP from 0 to 50 and legacy players without HP", () => {
  const schema = worldSchema.shape.players.element;
  const player = { id: visitId, position: { x: 100, y: 100 }, facing: { x: 1, y: 0 }, knockbackVelocity: { x: 0, y: 0 }, knockbackUntilTick: 0, stunnedUntilTick: 0, invulnerableUntilTick: 0, meleeReadyAtTick: 0, stoneReadyAtTick: 0, lastAction: null, lastHitTick: null };
  expect(schema.parse(player).hp).toBeUndefined();
  for (const hp of [0, 2, 47, 50]) expect(schema.parse({ ...player, hp }).hp).toBe(hp);
  for (const hp of [-1, 51, 2.5, Infinity, NaN, "50", null]) expect(schema.safeParse({ ...player, hp }).success).toBe(false);
  expect(schema.omit({ hp: true }).safeParse(player).success).toBe(true);
});
