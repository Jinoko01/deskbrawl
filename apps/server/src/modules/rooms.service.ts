import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../database';
import { DomainError } from '../domain.error';
import type { HostRoom } from '../generated/prisma/client';

@Injectable()
export class RoomsService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async mine(
    ownerDeviceId: string,
  ): Promise<Pick<HostRoom, 'id' | 'ownerDeviceId' | 'maxParticipants'>> {
    const room = await this.db.hostRoom.findUnique({
      where: { ownerDeviceId },
      select: { id: true, ownerDeviceId: true, maxParticipants: true },
    });
    if (room === null) {
      throw new DomainError('UNAUTHORIZED');
    }
    return room;
  }
}
