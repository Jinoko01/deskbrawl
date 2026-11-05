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

export interface AccessClaims {
  deviceId: string;
  // JWT exp in epoch milliseconds.
  expiresAt: number;
}

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
    return (await this.authenticate(token)).deviceId;
  }

  // Signature, claims and current device state; used once per connection.
  async authenticate(token: unknown): Promise<AccessClaims> {
    const claims = this.verifyToken(token);
    const device = await this.db.deviceIdentity.findUnique({
      where: { id: claims.deviceId },
      select: { revokedAt: true },
    });
    if (device === null || device.revokedAt !== null) {
      throw new DomainError('UNAUTHORIZED');
    }
    return claims;
  }

  // One query for any number of connections: ids that are revoked or deleted.
  async inactiveDevices(ids: string[]): Promise<Set<string>> {
    const devices = await this.db.deviceIdentity.findMany({
      where: { id: { in: ids } },
      select: { id: true, revokedAt: true },
    });
    const active = new Set(
      devices
        .filter((device) => device.revokedAt === null)
        .map((device) => device.id),
    );
    return new Set(ids.filter((id) => !active.has(id)));
  }

  private verifyToken(token: unknown): AccessClaims {
    if (typeof token !== 'string' || token.length > 4096) {
      throw new DomainError('UNAUTHORIZED');
    }
    let payload: { sub: unknown; exp: unknown };
    try {
      payload = this.jwt.verify<{ sub: unknown; exp: unknown }>(token, {
        secret: this.config.JWT_SECRET,
        algorithms: ['HS256'],
        issuer: 'deskbrawl',
        audience: 'deskbrawl-desktop',
      });
    } catch {
      throw new DomainError('UNAUTHORIZED');
    }
    const parsed = idSchema.safeParse(payload.sub);
    if (!parsed.success || typeof payload.exp !== 'number') {
      throw new DomainError('UNAUTHORIZED');
    }
    return { deviceId: parsed.data, expiresAt: payload.exp * 1000 };
  }
}
