import {
  afterEach, expect, it, vi,
} from "vitest";
import { registerDevice } from "./rooms";

afterEach(() => vi.unstubAllGlobals());

it("explains server database readiness failures without exposing internal errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "INTERNAL_ERROR" }), { status: 503 })));
  await expect(registerDevice("친구", new AbortController().signal)).rejects.toThrow("PostgreSQL 실행 상태");
});
