import type { errorSchema } from '@deskbrawl/protocol';
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { DomainError } from './domain.error';

export function failure(error: unknown): z.infer<typeof errorSchema> {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    switch (status) {
      case 401:
      case 403:
        return { ok: false, code: 'UNAUTHORIZED' };
      case 429:
        return { ok: false, code: 'RATE_LIMITED' };
      case 400:
      case 413:
      case 422:
        return { ok: false, code: 'INVALID_INPUT' };
      default:
        return { ok: false, code: 'INTERNAL_ERROR' };
    }
  }
  if (error instanceof DomainError) {
    return { ok: false, code: error.code };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  return { ok: false, code: 'INTERNAL_ERROR' };
}
