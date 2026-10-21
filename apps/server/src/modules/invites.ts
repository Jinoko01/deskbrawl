import { Controller, Delete, Inject, Injectable, Module, Post, Req } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { CONFIG } from "../config";
import type { Config } from "../config";
import { Database } from "../database";
import { DeviceAuthenticated, hash } from "./auth";
import type { AuthRequest } from "./auth";
import { RoomsModule, RoomsService } from "./rooms";

@Injectable()
export class InvitesService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(RoomsService) private readonly rooms: RoomsService, @Inject(CONFIG) private readonly config: Config) {}
  async rotate(owner: string) {
    const room = await this.rooms.mine(owner);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.INVITE_TTL_SECONDS * 1000);
    await this.db.serialize(() => this.db.inviteToken.upsert({ where: { hostRoomId: room.id }, create: { hostRoomId: room.id, tokenHash: hash(token), expiresAt }, update: { tokenHash: hash(token), expiresAt, createdAt: new Date() } }));
    return { link: `${this.config.PUBLIC_ORIGIN}/join/${token}`, expiresAt: expiresAt.getTime() };
  }
  async revoke(owner: string) { const room = await this.rooms.mine(owner); await this.db.serialize(() => this.db.inviteToken.deleteMany({ where: { hostRoomId: room.id } })); return { ok: true as const }; }
}
@Controller("v1/rooms/me/invites")
@DeviceAuthenticated()
class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}
  @Post() rotate(@Req() req: AuthRequest) { return this.invites.rotate(req.deviceId); }
  @Delete("current") revoke(@Req() req: AuthRequest) { return this.invites.revoke(req.deviceId); }
}
@Module({ imports: [RoomsModule], controllers: [InvitesController], providers: [InvitesService] })
export class InvitesModule {}
