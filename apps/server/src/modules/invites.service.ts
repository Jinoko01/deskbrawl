import type { inviteSchema, okSchema } from '@deskbrawl/protocol';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { Config } from '../config';
import { CONFIG } from '../config';
import { Database } from '../database';
import { RoomsService } from './rooms.service';
import { hash } from './token-hash';

@Injectable()
export class InvitesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async rotate(owner: string): Promise<z.infer<typeof inviteSchema>> {
    const room = await this.rooms.mine(owner);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.INVITE_TTL_SECONDS * 1000,
    );
    await this.db.serialize(() =>
      this.db.inviteToken.upsert({
        where: { hostRoomId: room.id },
        create: { hostRoomId: room.id, tokenHash: hash(token), expiresAt },
        update: { tokenHash: hash(token), expiresAt, createdAt: new Date() },
      }),
    );
    return {
      link: `${this.config.PUBLIC_ORIGIN}/join/${token}`,
      expiresAt: expiresAt.getTime(),
    };
  }

  async revoke(owner: string): Promise<z.infer<typeof okSchema>> {
    const room = await this.rooms.mine(owner);
    await this.db.serialize(() =>
      this.db.inviteToken.deleteMany({ where: { hostRoomId: room.id } }),
    );
    return { ok: true };
  }
}
