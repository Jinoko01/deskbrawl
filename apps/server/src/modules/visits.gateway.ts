import type {
  commandAckSchema,
  Joined,
  joinedAckSchema,
  RoomControl,
} from '@deskbrawl/protocol';
import {
  PROTOCOL_VERSION,
  inputSchema,
  leaveSchema,
  playerActionSchema,
  playerChatSchema,
  focusSchema,
  kickSchema,
  clearVisitorsSchema,
} from '@deskbrawl/protocol';
import type { OnModuleDestroy } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import type { Config } from '../config';
import { CONFIG } from '../config';
import { DomainError } from '../domain.error';
import { failure } from '../errors';
import { RateLimit } from '../rate-limit';
import type { RoomWorld } from '../game/simulation';
import { AuthService } from './auth.service';
import { VisitSessionService } from './visit-session.service';

@WebSocketGateway({ transports: ['websocket'], maxHttpBufferSize: 8192 })
export class VisitsGateway
  implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;
  private readonly limits = new RateLimit();
  private expiryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(VisitSessionService) private readonly sessions: VisitSessionService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  afterInit(server: Server): void {
    this.sessions.engine.onSnapshot = (room) => {
      this.sessions.engine.expireChats(room, Date.now());
      server
        .to(room.worldId)
        .emit('world:snapshot', this.sessions.engine.snapshot(room));
    };
    server.use((socket, next) => {
      void this.validateHandshake(socket).then(
        () => next(),
        (error: unknown) => next(new Error(failure(error).code)),
      );
    });
    // Token expiry/revocation must end idle sessions too.
    this.expiryTimer = setInterval(() => {
      for (const socket of server.sockets.sockets.values()) {
        void this.authenticate(socket).catch(() => {
          this.endSession(socket);
          socket.disconnect(true);
        });
      }
      for (const result of this.sessions.expireDisconnected()) {
        this.announceDeparture(result);
      }
    }, 1000);
  }

  onModuleDestroy(): void {
    if (this.expiryTimer !== undefined) {
      clearInterval(this.expiryTimer);
    }
  }

  private async validateHandshake(socket: Socket): Promise<void> {
    this.limits.take(`connect:${socket.handshake.address}`, 20, 60000);
    const origin = socket.handshake.headers.origin;
    if (origin !== undefined && !this.config.origins.includes(origin)) {
      throw new DomainError('UNAUTHORIZED');
    }

    const auth: unknown = socket.handshake.auth;
    if (
      typeof auth !== 'object' ||
      auth === null ||
      !('version' in auth) ||
      auth.version !== PROTOCOL_VERSION
    ) {
      throw new DomainError('INCOMPATIBLE_VERSION');
    }
    const token: unknown = 'token' in auth ? auth.token : undefined;
    await this.auth.verify(token);
  }

  private async authenticate(socket: Socket): Promise<string> {
    const auth: unknown = socket.handshake.auth;
    return this.auth.verify(
      typeof auth === 'object' && auth !== null && 'token' in auth
        ? auth.token
        : undefined,
    );
  }

  private async command<T>(
    socket: Socket,
    limit: number,
    kind: string,
    operation: (device: string) => Promise<T> | T,
  ): Promise<T | ReturnType<typeof failure>> {
    try {
      this.limits.take(`${kind}:${socket.id}`, limit);
      const device = await this.authenticate(socket);
      if (!socket.connected) {
        throw new DomainError('CONNECTION_LOST');
      }
      return await operation(device);
    } catch (error) {
      return failure(error);
    }
  }

  private async enter(socket: Socket, joined: Joined): Promise<Joined> {
    if (!socket.connected) {
      this.handleDisconnect(socket);
      throw new DomainError('CONNECTION_LOST');
    }
    await socket.join(joined.worldId);
    try {
      const { room, member } = this.sessions.find(socket.id);
      if (
        !socket.connected ||
        member.visitId !== joined.visitId ||
        room.worldId !== joined.worldId
      ) {
        throw new DomainError('SESSION_ENDED');
      }
      const current = this.sessions.joined(room, member);
      socket.emit('visit:joined', current);
      this.publishProfiles(room);
      this.server.to(room.worldId).emit('world:snapshot', current.snapshot);
      return current;
    } catch (error) {
      // Focus/kick can remove a member while the transport joins asynchronously.
      await socket.leave(joined.worldId);
      throw error;
    }
  }

  @SubscribeMessage('room:host')
  host(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof joinedAckSchema>> {
    return this.command(socket, 5, 'join', async (device) =>
      this.enter(socket, await this.sessions.host(socket, device, body)),
    );
  }

  @SubscribeMessage('visit:join')
  join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof joinedAckSchema>> {
    return this.command(socket, 5, 'join', async (device) =>
      this.enter(socket, await this.sessions.join(socket, device, body)),
    );
  }

  @SubscribeMessage('visit:resume')
  resume(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof joinedAckSchema>> {
    return this.command(socket, 5, 'join', async (device) =>
      this.enter(socket, await this.sessions.resume(socket, device, body)),
    );
  }

  @SubscribeMessage('visit:leave')
  leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 10, 'leave', () => {
      const input = leaveSchema.parse(body);
      const { member } = this.sessions.find(socket.id);
      if (input.visitId !== member.visitId) {
        throw new DomainError('SESSION_ENDED');
      }
      this.endSession(socket);
      return { ok: true as const };
    });
  }

  @SubscribeMessage('player:input')
  input(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 40, 'input', () => {
      const command = inputSchema.parse(body);
      const { room, member } = this.sessions.find(socket.id);
      this.sessions.engine.input(room, member, command);
      return { ok: true as const };
    });
  }

  @SubscribeMessage('player:chat')
  chat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 30, 'chat', () => {
      const command = playerChatSchema.parse(body);
      const { room, member } = this.sessions.find(socket.id);
      this.sessions.engine.chat(room, member, command, Date.now());
      return { ok: true as const };
    });
  }

  @SubscribeMessage('player:action')
  action(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 10, 'action', () => {
      const command = playerActionSchema.parse(body);
      const { room, member } = this.sessions.find(socket.id);
      this.sessions.engine.action(room, member, command);
      return { ok: true as const };
    });
  }

  @SubscribeMessage('player:profile')
  profile(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 5, 'profile', async (device) => {
      const room = await this.sessions.profile(socket.id, device, body);
      this.publishProfiles(room);
      this.server
        .to(room.worldId)
        .emit('world:snapshot', this.sessions.engine.snapshot(room));
      return { ok: true as const };
    });
  }

  private publishProfiles(room: RoomWorld): void {
    this.server.to(room.worldId).emit('room:profiles', {
      roomId: room.roomId,
      worldId: room.worldId,
      profiles: [...room.members.values()].map((member) => ({
        playerId: member.playerId,
        skin: member.skin ?? (member.role === 'host' ? 'mochi' : 'mint'),
      })),
    });
  }

  private async controlRoom(
    socket: Socket,
    device: string,
    command: RoomControl,
  ): Promise<{ ok: true }> {
    const { room, removed } = await this.sessions.control(
      socket.id,
      device,
      command,
    );
    const code = 'focused' in command ? 'ROOM_UNAVAILABLE' : 'KICKED';
    for (const visitor of removed) {
      this.server.to(visitor.socketId).emit('room:closed', { ok: false, code });
      this.server.in(visitor.socketId).socketsLeave(room.worldId);
    }
    this.server
      .to(room.worldId)
      .emit('world:snapshot', this.sessions.engine.snapshot(room));
    return { ok: true };
  }

  @SubscribeMessage('room:focus')
  focus(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 10, 'control', (device) =>
      this.controlRoom(socket, device, focusSchema.parse(body)),
    );
  }

  @SubscribeMessage('visit:kick')
  kick(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 10, 'control', (device) =>
      this.controlRoom(socket, device, kickSchema.parse(body)),
    );
  }

  @SubscribeMessage('visit:clear')
  clear(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 10, 'control', (device) =>
      this.controlRoom(socket, device, clearVisitorsSchema.parse(body)),
    );
  }

  handleDisconnect(socket: Socket): void {
    this.sessions.disconnect(socket.id);
  }

  private endSession(socket: Socket): void {
    const result = this.sessions.leave(socket.id);
    if (result === undefined) {
      return;
    }
    void socket.leave(result.room.worldId);
    this.announceDeparture(result);
  }

  private announceDeparture(
    result: NonNullable<ReturnType<VisitSessionService['leave']>>,
  ): void {
    if (result.closed) {
      this.server
        .to(result.room.worldId)
        .emit('room:closed', { ok: false, code: 'HOST_OFFLINE' });
      this.server.in(result.room.worldId).socketsLeave(result.room.worldId);
    } else {
      this.server
        .to(result.room.worldId)
        .emit('world:snapshot', this.sessions.engine.snapshot(result.room));
    }
  }
}
