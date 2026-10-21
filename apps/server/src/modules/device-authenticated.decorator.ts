import { UseGuards } from '@nestjs/common';
import { DeviceGuard } from './device.guard';

// Exported for REST routes; gateway uses the same verifier on every command.
export const DeviceAuthenticated = (): MethodDecorator & ClassDecorator =>
  UseGuards(DeviceGuard);
