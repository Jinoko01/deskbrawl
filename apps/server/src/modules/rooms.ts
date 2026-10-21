import { Controller, Get, Inject, Injectable, Module, Req } from "@nestjs/common";
import { Database } from "../database";
import { DeviceAuthenticated } from "./auth";
import type { AuthRequest } from "./auth";
import { DomainError } from "../errors";

@Injectable()
export class RoomsService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async mine(ownerDeviceId: string) {
    const room = await this.db.hostRoom.findUnique({ where: { ownerDeviceId }, select: { id: true, ownerDeviceId: true, maxParticipants: true } });
    if (room === null) throw new DomainError("UNAUTHORIZED");
    return room;
  }
}
@Controller("v1/rooms")
@DeviceAuthenticated()
class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}
  @Get("me") mine(@Req() req: AuthRequest) { return this.rooms.mine(req.deviceId); }
}
@Module({ controllers: [RoomsController], providers: [RoomsService], exports: [RoomsService] })
export class RoomsModule {}
