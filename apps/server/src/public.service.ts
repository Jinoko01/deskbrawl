import { Inject, Injectable } from '@nestjs/common';
import { Database } from './database';

@Injectable()
export class PublicService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async health(): Promise<{ ok: true }> {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
