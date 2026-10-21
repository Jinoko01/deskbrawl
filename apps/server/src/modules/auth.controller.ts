import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Controller('v1/devices')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post()
  register(
    @Req() req: Request,
    @Body() body: unknown,
  ): ReturnType<AuthService['register']> {
    this.auth.limits.take(`register:${req.ip}`, 10, 60000);
    return this.auth.register(body);
  }

  @Post('session')
  restore(
    @Req() req: Request,
    @Body() body: unknown,
  ): ReturnType<AuthService['restore']> {
    this.auth.limits.take(`restore:${req.ip}`, 20, 60000);
    return this.auth.restore(body);
  }
}
