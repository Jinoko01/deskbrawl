import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Config } from './config';
import { CONFIG } from './config';
import { PrismaClient } from './generated/prisma/client';

@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private tail = Promise.resolve();
  private queued = 0;

  constructor(@Inject(CONFIG) config: Config) {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  // ponytail: one control-operation queue for this single server; partition by room if measured contention requires it.
  async serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queued >= 128) {
      throw new Error('Control queue full');
    }
    this.queued++;
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => {},
      () => {},
    );
    try {
      return await result;
    } finally {
      this.queued--;
    }
  }
}
