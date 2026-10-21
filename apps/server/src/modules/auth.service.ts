import type { Session, registrationSchema } from '@deskbrawl/protocol';
import {
  credentialSchema,
  idSchema,
  registerSchema,
} from '@deskbrawl/protocol';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { Config } from '../config';
import { CONFIG } from '../config';
import { Database } from '../database';
import { DomainError } from '../domain.error';
import { RateLimit } from '../rate-limit';
import { hash } from './token-hash';

@Injectable()
export class AuthService {
  readonly limits = new RateLimit();

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private issue(deviceId: string): Session {
    const expiresAt = Date.now() + this.config.ACCESS_TTL_SECONDS * 1000;
    return {
      deviceId,
      accessToken: this.jwt.sign(
        { sub: deviceId },
        {
          secret: this.config.JWT_SECRET,
          algorithm: 'HS256',
          issuer: 'deskbrawl',
          audience: 'deskbrawl-desktop',
          expiresIn: this.config.ACCESS_TTL_SECONDS,
        },
      ),
      expiresAt,
    };
  }

  async register(body: unknown): Promise<z.infer<typeof registrationSchema>> {
    const { nickname } = registerSchema.parse(body);
    const secret = randomBytes(32).toString('base64url');
    const device = await this.db.deviceIdentity.create({
      data: { nickname, secretHash: hash(secret), room: { create: {} } },
      select: { id: true },
    });
    return { ...this.issue(device.id), secret };
  }

  async restore(body: unknown): Promise<Session> {
    const credential = credentialSchema.parse(body);
    const device = await this.db.deviceIdentity.findUnique({
      where: { id: credential.deviceId },
    });
    if (
      device === null ||
      device.revokedAt !== null ||
      !timingSafeEqual(
        Buffer.from(device.secretHash, 'hex'),
        Buffer.from(hash(credential.secret), 'hex'),
      )
    ) {
      throw new DomainError('UNAUTHORIZED');
    }
    return this.issue(device.id);
  }

  async verify(token: unknown): Promise<string> {
    if (typeof token !== 'string' || token.length > 4096) {
      throw new DomainError('UNAUTHORIZED');
    }
    let sub: unknown;
    try {
      sub = this.jwt.verify<{ sub: unknown }>(token, {
        secret: this.config.JWT_SECRET,
        algorithms: ['HS256'],
        issuer: 'deskbrawl',
        audience: 'deskbrawl-desktop',
      }).sub;
    } catch {
      throw new DomainError('UNAUTHORIZED');
    }
    const parsed = idSchema.safeParse(sub);
    if (!parsed.success) {
      throw new DomainError('UNAUTHORIZED');
    }
    const device = await this.db.deviceIdentity.findUnique({
      where: { id: parsed.data },
      select: { revokedAt: true },
    });
    if (device === null || device.revokedAt !== null) {
      throw new DomainError('UNAUTHORIZED');
    }
    return parsed.data;
  }
}
