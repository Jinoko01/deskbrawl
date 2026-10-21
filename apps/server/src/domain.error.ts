import type { ErrorCode } from '@deskbrawl/protocol';

export class DomainError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
