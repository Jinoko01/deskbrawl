import type { Joined, RoomControl } from '@deskbrawl/protocol';
import {
  hostSchema,
  joinSchema,
  resumeSchema,
  playerProfileSchema,
} from '@deskbrawl/protocol';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import { Database } from '../database';
import { DomainError } from '../domain.error';
import type { Member, RoomWorld } from '../game/simulation';
import { SimulationEngine } from '../game/simulation';
import { RoomsService } from './rooms.service';
import { hash } from './token-hash';

@Injectable()
export class VisitSessionService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(RoomsService) private readonly rooms: RoomsService,
    @Inject(SimulationEngine) readonly engine: SimulationEngine,
  ) {}

  private createMember(
    deviceId: string,
    nickname: string,
    socketId: string,
    role: Member['role'],
  ): Member {
    return {
      playerId: deviceId,
      nickname,
      socketId,
      role,
      visitId: randomUUID(),
      resumeToken: randomBytes(32).toString('base64url'),
      disconnectExpiresAt: undefined,
      movement: { x: 0, y: 0 },
      seq: 0,
      appliedSeq: 0,
      inputAtTick: 0,
      action: undefined,
      actionIds: [],
      chatSeq: 0,
    };
  }

  find(socketId: string): { room: RoomWorld; member: Member } {
    for (const room of this.engine.rooms.values()) {
      for (const member of room.members.values()) {
        if (member.socketId === socketId) {
          return { room, member };
        }
      }
    }
    throw new DomainError('SESSION_ENDED');
  }

  joined(room: RoomWorld, member: Member): Joined {
    return {
      ok: true,
      roomId: room.roomId,
      worldId: room.worldId,
      visitId: member.visitId,
      playerId: member.playerId,
      resumeToken: member.resumeToken,
      role: member.role,
      snapshot: this.engine.snapshot(room),
    };
  }

  async host(socket: Socket, deviceId: string, body: unknown): Promise<Joined> {
    const input = hostSchema.parse(body);
    return this.db.serialize(async () => {
      const roomInfo = await this.rooms.mine(deviceId);
      const existing = this.engine.rooms.get(roomInfo.id);
      if (existing !== undefined) {
        const member = existing.members.get(deviceId);
        if (member?.socketId === socket.id) {
          return this.joined(existing, member);
        }
        throw new DomainError('ALREADY_VISITING');
      }
      this.assertNotVisiting(deviceId);
      const device = await this.db.deviceIdentity.findUniqueOrThrow({
        where: { id: deviceId },
      });
      if (!socket.connected) {
        throw new DomainError('CONNECTION_LOST');
      }
      const member = this.createMember(
        deviceId,
        device.nickname,
        socket.id,
        'host',
      );
      const room = this.engine.open(roomInfo.id, input.bounds, member);
      this.engine.focus(room, input.focused ?? false);
      return this.joined(room, member);
    });
  }

  async join(socket: Socket, deviceId: string, body: unknown): Promise<Joined> {
    const input = joinSchema.parse(body);
    return this.db.serialize(async () => {
      const invite = await this.db.inviteToken.findUnique({
        where: { tokenHash: hash(input.token) },
        include: { room: true },
      });
      if (invite === null || invite.expiresAt.getTime() <= Date.now()) {
        throw new DomainError('INVALID_INVITE');
      }
      if (invite.room.ownerDeviceId === deviceId) {
        throw new DomainError('SELF_VISIT');
      }
      const device = await this.db.deviceIdentity.findUniqueOrThrow({
        where: { id: deviceId },
      });
      if (!socket.connected) {
        throw new DomainError('CONNECTION_LOST');
      }
      const room = this.engine.rooms.get(invite.hostRoomId);
      if (room === undefined) {
        throw new DomainError('HOST_OFFLINE');
      }
      if (
        [...room.members.values()].some(
          (member) =>
            member.role === 'host' && member.disconnectExpiresAt !== undefined,
        )
      ) {
        throw new DomainError('HOST_OFFLINE');
      }
      if (room.focused) {
        throw new DomainError('ROOM_UNAVAILABLE');
      }
      const existing = room.members.get(deviceId);
      if (existing?.socketId === socket.id) {
        return this.joined(room, existing);
      }
      this.assertNotVisiting(deviceId);
      if (room.members.size >= invite.room.maxParticipants) {
        throw new DomainError('ROOM_FULL');
      }
      const member = this.createMember(
        deviceId,
        device.nickname,
        socket.id,
        'guest',
      );
      member.inputAtTick = room.world.tick;
      this.engine.add(room, member);
      return this.joined(room, member);
    });
  }

  async resume(
    socket: Socket,
    deviceId: string,
    body: unknown,
  ): Promise<Joined> {
    const input = resumeSchema.parse(body);
    return this.db.serialize(() => {
      for (const room of this.engine.rooms.values()) {
        const member = room.members.get(deviceId);
        if (
          member?.visitId !== input.visitId ||
          member.resumeToken !== input.resumeToken
        ) {
          continue;
        }
        if (
          member.disconnectExpiresAt === undefined ||
          member.disconnectExpiresAt <= Date.now()
        ) {
          throw new DomainError('SESSION_ENDED');
        }
        if (!socket.connected) {
          throw new DomainError('CONNECTION_LOST');
        }
        member.socketId = socket.id;
        member.visitId = randomUUID();
        member.resumeToken = randomBytes(32).toString('base64url');
        member.disconnectExpiresAt = undefined;
        member.movement = { x: 0, y: 0 };
        member.action = undefined;
        member.seq = 0;
        member.chatSeq = 0;
        member.appliedSeq = 0;
        member.inputAtTick = room.world.tick;
        return this.joined(room, member);
      }
      throw new DomainError('SESSION_ENDED');
    });
  }

  async profile(
    socketId: string,
    deviceId: string,
    body: unknown,
  ): Promise<RoomWorld> {
    const input = playerProfileSchema.parse(body);
    return this.db.serialize(async () => {
      const { room, member } = this.find(socketId);
      if (member.playerId !== deviceId || member.visitId !== input.visitId) {
        throw new DomainError('SESSION_ENDED');
      }
      if (input.nickname !== undefined) {
        await this.db.deviceIdentity.update({
          where: { id: deviceId },
          data: { nickname: input.nickname },
        });
        member.nickname = input.nickname;
      }
      if (input.skin !== undefined) {
        member.skin = input.skin;
      }
      return room;
    });
  }

  disconnect(socketId: string): void {
    let found;
    try {
      found = this.find(socketId);
    } catch {
      return;
    }
    found.room.chats.delete(found.member.playerId);
    found.member.socketId = '';
    // Provisional M4 recovery window; no persistence across server restarts.
    found.member.disconnectExpiresAt = Date.now() + 10_000;
    found.member.movement = { x: 0, y: 0 };
    found.member.action = undefined;
  }

  expireDisconnected(
    nowMs = Date.now(),
  ): { closed: boolean; room: RoomWorld }[] {
    const results: { closed: boolean; room: RoomWorld }[] = [];
    for (const room of this.engine.rooms.values()) {
      const expired = [...room.members.values()].filter(
        (member) =>
          member.disconnectExpiresAt !== undefined &&
          member.disconnectExpiresAt <= nowMs,
      );
      if (expired.some((member) => member.role === 'host')) {
        this.engine.rooms.delete(room.roomId);
        results.push({ closed: true, room });
        continue;
      }
      for (const member of expired) {
        this.engine.remove(room, member.playerId);
      }
      if (expired.length > 0) {
        results.push({ closed: false, room });
      }
    }
    return results;
  }

  async control(
    socketId: string,
    deviceId: string,
    command: RoomControl,
  ): Promise<{ room: RoomWorld; removed: Member[] }> {
    // Shares the invitation queue: a join cannot slip between focus validation and eviction.
    return this.db.serialize(() => {
      const { room, member } = this.find(socketId);
      if (member.role !== 'host' || member.playerId !== deviceId) {
        throw new DomainError('UNAUTHORIZED');
      }
      if (command.visitId !== member.visitId) {
        throw new DomainError('SESSION_ENDED');
      }
      if (
        'targetPlayerId' in command &&
        command.targetPlayerId === member.playerId
      ) {
        throw new DomainError('INVALID_INPUT');
      }
      const signature = JSON.stringify(command);
      const previous = room.controlCommands.get(command.commandId);
      if (previous !== undefined) {
        if (previous !== signature) {
          throw new DomainError('INVALID_INPUT');
        }
        return { room, removed: [] };
      }
      const removed = [...room.members.values()].filter((candidate) => {
        if (candidate.role !== 'guest') {
          return false;
        }
        if ('focused' in command) {
          return command.focused;
        }
        return (
          !('targetPlayerId' in command) ||
          candidate.playerId === command.targetPlayerId
        );
      });
      for (const visitor of removed) {
        this.engine.remove(room, visitor.playerId);
      }
      if ('focused' in command) {
        this.engine.focus(room, command.focused);
      }
      room.controlCommands.set(command.commandId, signature);
      // Keep only the bounded retry window for control commands.
      if (room.controlCommands.size > 128) {
        const oldest = room.controlCommands.keys().next().value;
        if (oldest !== undefined) {
          room.controlCommands.delete(oldest);
        }
      }
      return { room, removed };
    });
  }

  leave(socketId: string): { closed: boolean; room: RoomWorld } | undefined {
    let found;
    try {
      found = this.find(socketId);
    } catch {
      return;
    }
    const { room, member } = found;
    if (member.role === 'host') {
      this.engine.rooms.delete(room.roomId);
      return { closed: true, room };
    }
    this.engine.remove(room, member.playerId);
    return { closed: false, room };
  }

  private assertNotVisiting(deviceId: string): void {
    for (const room of this.engine.rooms.values()) {
      if (room.members.has(deviceId)) {
        throw new DomainError('ALREADY_VISITING');
      }
    }
  }
}
