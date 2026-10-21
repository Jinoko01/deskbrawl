import { Controller, Delete, Inject, Post, Req } from '@nestjs/common';
import type { AuthRequest } from './auth-request';
import { DeviceAuthenticated } from './device-authenticated.decorator';
import { InvitesService } from './invites.service';

@Controller('v1/rooms/me/invites')
@DeviceAuthenticated()
export class InvitesController {
  constructor(
    @Inject(InvitesService) private readonly invites: InvitesService,
  ) {}

  @Post()
  rotate(@Req() req: AuthRequest): ReturnType<InvitesService['rotate']> {
    return this.invites.rotate(req.deviceId);
  }

  @Delete('current')
  revoke(@Req() req: AuthRequest): ReturnType<InvitesService['revoke']> {
    return this.invites.revoke(req.deviceId);
  }
}
