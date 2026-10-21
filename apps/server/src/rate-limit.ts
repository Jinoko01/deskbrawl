import { DomainError } from './domain.error';

// Maps remain bounded even when callers continually change IP/device identifiers.
export class RateLimit {
  private readonly entries = new Map<
    string,
    { start: number; count: number }
  >();

  take(key: string, limit: number, windowMs = 1000): void {
    const now = performance.now();
    let entry = this.entries.get(key);
    if (entry === undefined || now - entry.start >= windowMs) {
      if (this.entries.size >= 10000) {
        for (const [id, value] of this.entries) {
          if (now - value.start >= 60000) {
            this.entries.delete(id);
          }
        }
        if (this.entries.size >= 10000) {
          throw new DomainError('RATE_LIMITED');
        }
      }
      entry = { start: now, count: 0 };
      this.entries.set(key, entry);
    }
    if (++entry.count > limit) {
      throw new DomainError('RATE_LIMITED');
    }
  }
}
