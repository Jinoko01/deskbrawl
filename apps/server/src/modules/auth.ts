import { Body, Controller, Global, Inject, Injectable, Module, Post, Req, UseGuards } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { credentialSchema, idSchema, registerSchema } from "@deskbrawl/protocol";
import { CONFIG } from "../config";
import type { Config } from "../config";
import { Database } from "../database";
import { DomainError, RateLimit } from "../errors";

export function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export type AuthRequest = Request & { deviceId: string };
@Injectable()
export class AuthService {
  readonly limits = new RateLimit();
  constructor(@Inject(Database) private readonly db: Database, @Inject(JwtService) private readonly jwt: JwtService, @Inject(CONFIG) private readonly config: Config) {}
  private issue(deviceId: string) {
    const expiresAt = Date.now() + this.config.ACCESS_TTL_SECONDS * 1000;
    return { deviceId, accessToken: this.jwt.sign({ sub: deviceId }, { secret: this.config.JWT_SECRET, algorithm: "HS256", issuer: "deskbrawl", audience: "deskbrawl-desktop", expiresIn: this.config.ACCESS_TTL_SECONDS }), expiresAt };
  }
  async register(body: unknown) {
    const { nickname } = registerSchema.parse(body);
    const secret = randomBytes(32).toString("base64url");
    const device = await this.db.deviceIdentity.create({ data: { nickname, secretHash: hash(secret), room: { create: {} } }, select: { id: true } });
    return { ...this.issue(device.id), secret };
  }
  async restore(body: unknown) {
    const credential = credentialSchema.parse(body);
    const device = await this.db.deviceIdentity.findUnique({ where: { id: credential.deviceId } });
    if (device === null || device.revokedAt !== null || !timingSafeEqual(Buffer.from(device.secretHash, "hex"), Buffer.from(hash(credential.secret), "hex"))) throw new DomainError("UNAUTHORIZED");
    return this.issue(device.id);
  }
  async verify(token: unknown): Promise<string> {
    if (typeof token !== "string" || token.length > 4096) throw new DomainError("UNAUTHORIZED");
    let sub: unknown;
    try { sub = this.jwt.verify<{ sub: unknown }>(token, { secret: this.config.JWT_SECRET, algorithms: ["HS256"], issuer: "deskbrawl", audience: "deskbrawl-desktop" }).sub; }
    catch { throw new DomainError("UNAUTHORIZED"); }
    const parsed = idSchema.safeParse(sub);
    if (!parsed.success) throw new DomainError("UNAUTHORIZED");
    const device = await this.db.deviceIdentity.findUnique({ where: { id: parsed.data }, select: { revokedAt: true } });
    if (device === null || device.revokedAt !== null) throw new DomainError("UNAUTHORIZED");
    return parsed.data;
  }
}
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    this.auth.limits.take(`rest:${request.ip}`, 30);
    request.deviceId = await this.auth.verify(request.headers.authorization?.replace(/^Bearer /, ""));
    return true;
  }
}
@Controller("v1/devices")
class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post()
  register(@Req() req: Request, @Body() body: unknown) { this.auth.limits.take(`register:${req.ip}`, 10, 60000); return this.auth.register(body); }
  @Post("session")
  restore(@Req() req: Request, @Body() body: unknown) { this.auth.limits.take(`restore:${req.ip}`, 20, 60000); return this.auth.restore(body); }
}
// Exported for REST routes; gateway uses the same verifier on every command.
export const DeviceAuthenticated = () => UseGuards(DeviceGuard);
@Global()
@Module({ imports: [JwtModule.register({})], controllers: [AuthController], providers: [AuthService, DeviceGuard], exports: [AuthService, DeviceGuard] })
export class AuthModule {}
