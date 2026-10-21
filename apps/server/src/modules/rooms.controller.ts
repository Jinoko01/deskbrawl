import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { AuthRequest } from './auth-request';
import { DeviceAuthenticated } from './device-authenticated.decorator';
import { RoomsService } from './rooms.service';

@Controller('v1/rooms')
@DeviceAuthenticated()
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Get('me')
  mine(@Req() req: AuthRequest): ReturnType<RoomsService['mine']> {
    return this.rooms.mine(req.deviceId);
  }
}
