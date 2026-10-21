import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthRequest } from './auth-request';
import { AuthService } from './auth.service';

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    this.auth.limits.take(`rest:${request.ip}`, 30);
    request.deviceId = await this.auth.verify(
      request.headers.authorization?.replace(/^Bearer /, ''),
    );
    return true;
  }
}
