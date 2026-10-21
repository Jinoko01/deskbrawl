import { Catch, HttpException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import type { ErrorCode } from "@deskbrawl/protocol";
import { z } from "zod";

export class DomainError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
export function failure(error: unknown): { ok: false; code: ErrorCode } {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = status === 401 || status === 403 ? "UNAUTHORIZED" : status === 429 ? "RATE_LIMITED"
      : [400, 413, 422].includes(status) ? "INVALID_INPUT" : "INTERNAL_ERROR";
    return { ok: false, code };
  }
  return { ok: false, code: error instanceof DomainError ? error.code : error instanceof z.ZodError ? "INVALID_INPUT" : "INTERNAL_ERROR" };
}
@Catch()
export class HttpErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const parserType = typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
    if (parserType === "entity.parse.failed" || parserType === "entity.too.large") {
      response.status(parserType === "entity.too.large" ? 413 : 400).json({ ok: false, code: "INVALID_INPUT" });
      return;
    }
    const body = failure(error);
    const status = error instanceof HttpException ? error.getStatus() : body.code === "UNAUTHORIZED" ? 401 : body.code === "INTERNAL_ERROR" ? 500 : body.code === "RATE_LIMITED" ? 429 : 400;
    response.status(status).json(body);
  }
}

// Maps remain bounded even when callers continually change IP/device identifiers.
export class RateLimit {
  private readonly entries = new Map<string, { start: number; count: number }>();
  take(key: string, limit: number, windowMs = 1000): void {
    const now = performance.now();
    let entry = this.entries.get(key);
    if (entry === undefined || now - entry.start >= windowMs) {
      if (this.entries.size >= 10000) {
        for (const [id, value] of this.entries) if (now - value.start >= 60000) this.entries.delete(id);
        if (this.entries.size >= 10000) throw new DomainError("RATE_LIMITED");
      }
      entry = { start: now, count: 0 }; this.entries.set(key, entry);
    }
    if (++entry.count > limit) throw new DomainError("RATE_LIMITED");
  }
}
