import { describe, expect, it } from "vitest";
import { hostSchema, inputSchema, joinSchema, parseInviteLink, playerActionSchema } from "./index";

const token = "a".repeat(43);
const visitId = "123e4567-e89b-42d3-a456-426614174000";
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
    expect(hostSchema.safeParse({ version: 1, bounds: { width: 1e9, height: 720 } }).success).toBe(false);
    expect(playerActionSchema.safeParse({ visitId, actionId: visitId, action: "stone", targetId: visitId }).success).toBe(false);
  });
});
