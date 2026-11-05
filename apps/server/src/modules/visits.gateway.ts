import type {
  commandAckSchema,
  Joined,
  joinedAckSchema,
  RoomControl,
  Snapshot,
} from '@deskbrawl/protocol';
import {
  PROTOCOL_VERSION,
  inputSchema,
  leaveSchema,
  playerActionSchema,
  playerChatSchema,
  playerModeSchema,
  playerPositionSchema,
  socketCapabilitiesSchema,
  focusSchema,
  kickSchema,
  clearVisitorsSchema,
} from '@deskbrawl/protocol';
import type { OnModuleDestroy } from '@nestjs/common';
import { Inject, Logger } from '@nestjs/common';
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
import type { AccessClaims } from './auth.service';
import { AuthService } from './auth.service';
import { VisitSessionService } from './visit-session.service';

// Client display windows for attack motions (desktop networkScene).
const ATTACK_DISPLAY_MS = { melee: 400, stone: 300 } as const;

interface SentSnapshot {
  key: string;
  settled: boolean;
}

@WebSocketGateway({ transports: ['websocket'], maxHttpBufferSize: 8192 })
export class VisitsGateway
  implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;
  private readonly limits = new RateLimit();
  private expiryTimer: ReturnType<typeof setInterval> | undefined;
  // Last snapshot sent per room; released together with the room object.
  private readonly sent = new WeakMap<RoomWorld, SentSnapshot>();
  // Handshake auth result per connection; released with the socket.
  private readonly claims = new WeakMap<Socket, AccessClaims>();
  private readonly logger = new Logger(VisitsGateway.name);
  private checking = false;
  private checkFailing = false;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(VisitSessionService) private readonly sessions: VisitSessionService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  afterInit(server: Server): void {
    server.on('connection', (socket) =>
      socket.emit('server:features', { workDrag: true }),
    );
    this.sessions.engine.onSnapshot = (room) => {
      this.sessions.engine.expireChats(room, Date.now());
      this.publishSnapshot(room, true);
    };
    server.use((socket, next) => {
      void this.validateHandshake(socket).then(
        () => next(),
        (error: unknown) => next(new Error(failure(error).code)),
      );
    });
    // Token expiry/revocation must end idle sessions too.
    this.expiryTimer = setInterval(() => {
      void this.checkDevices(server);
      for (const result of this.sessions.expireDisconnected()) {
        this.announceDeparture(result);
      }
    }, 1000);
  }

  // Revocation reaches open connections within one interval (accepted ~1s).
  // During a DB outage open connections keep their verified token until it
  // expires; new handshakes still need the DB.
  private async checkDevices(server: Server): Promise<void> {
    if (this.checking) {
      return;
    }
    this.checking = true;
    try {
      const now = Date.now();
      const byDevice = new Map<string, Socket[]>();
      for (const socket of server.sockets.sockets.values()) {
        const claims = this.claims.get(socket);
        if (claims === undefined || claims.expiresAt <= now) {
          this.closeSession(socket);
          continue;
        }
        byDevice.set(claims.deviceId, [
          ...(byDevice.get(claims.deviceId) ?? []),
          socket,
        ]);
      }
      if (byDevice.size === 0) {
        return;
      }

      let inactive: Set<string>;
      try {
        inactive = await this.auth.inactiveDevices([...byDevice.keys()]);
      } catch {
        if (!this.checkFailing) {
          this.logger.warn('Device revocation check failed; retrying');
        }
        this.checkFailing = true;
        return;
      }
      this.checkFailing = false;
      for (const deviceId of inactive) {
        for (const socket of byDevice.get(deviceId) ?? []) {
          this.closeSession(socket);
        }
      }
    } finally {
      this.checking = false;
    }
  }

  private closeSession(socket: Socket): void {
    this.endSession(socket);
    socket.disconnect(true);
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
    this.claims.set(socket, await this.auth.authenticate(token));
  }

  // The handshake token is fixed for the connection, so commands only need
  // the expiry; revocation is checked in batch by checkDevices().
  private authenticated(socket: Socket): string {
    const claims = this.claims.get(socket);
    if (claims === undefined || claims.expiresAt <= Date.now()) {
      throw new DomainError('UNAUTHORIZED');
    }
    return claims.deviceId;
  }

  private async command<T>(
    socket: Socket,
    limit: number,
    kind: string,
    operation: (device: string) => Promise<T> | T,
  ): Promise<T | ReturnType<typeof failure>> {
    try {
      this.limits.take(`${kind}:${socket.id}`, limit);
      const device = this.authenticated(socket);
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
      const response = {
        ...current,
        snapshot: this.clientSnapshot(socket, current.snapshot),
      };
      socket.emit('visit:joined', response);
      this.publishProfiles(room);
      this.publishSnapshot(room);
      return response;
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

  @SubscribeMessage('player:mode')
  playerMode(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 20, 'mode', () => {
      const input = playerModeSchema.parse(body);
      const { room, member } = this.sessions.find(socket.id);
      if (input.visitId !== member.visitId) {
        throw new DomainError('SESSION_ENDED');
      }
      this.sessions.engine.setMode(room, member, input.seq, input.playing);
      return { ok: true as const };
    });
  }

  @SubscribeMessage('player:position')
  playerPosition(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<z.infer<typeof commandAckSchema>> {
    return this.command(socket, 40, 'position', () => {
      const input = playerPositionSchema.parse(body);
      const { room, member } = this.sessions.find(socket.id);
      if (input.visitId !== member.visitId) {
        throw new DomainError('SESSION_ENDED');
      }
      this.sessions.engine.place(room, member, input.seq, input.position);
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
      this.publishSnapshot(room);
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

  private capabilities(
    socket: Socket,
  ): z.infer<typeof socketCapabilitiesSchema> {
    const result = socketCapabilitiesSchema.safeParse(socket.handshake.auth);
    return result.success ? result.data : {};
  }

  private clientSnapshot(socket: Socket, snapshot: Snapshot): Snapshot {
    if (this.capabilities(socket).health === true) {
      return snapshot;
    }
    // Existing v2 clients reject unknown player fields in their strict schema.
    return {
      ...snapshot,
      world: {
        ...snapshot.world,
        players: snapshot.world.players.map((player) => {
          const legacy = { ...player };
          delete legacy.hp;
          return legacy;
        }),
      },
    };
  }

  // Periodic tick snapshots may be skipped for idleSnapshots clients once the
  // world has settled; explicit events always send the full current state.
  private publishSnapshot(room: RoomWorld, periodic = false): void {
    const snapshot = this.sessions.engine.snapshot(room);
    const skipIdle = this.isSettledRepeat(room, snapshot, periodic);
    for (const member of room.members.values()) {
      const socket = this.server.sockets.sockets.get(member.socketId);
      if (!socket?.rooms.has(room.worldId)) {
        continue;
      }
      if (skipIdle && this.capabilities(socket).idleSnapshots === true) {
        continue;
      }
      socket.emit('world:snapshot', this.clientSnapshot(socket, snapshot));
    }
  }

  private isSettledRepeat(
    room: RoomWorld,
    snapshot: Snapshot,
    periodic: boolean,
  ): boolean {
    // Only the auto-incrementing tick is excluded from the comparison.
    const key = JSON.stringify({
      ...snapshot,
      world: { ...snapshot.world, tick: 0 },
    });
    const previous = this.sent.get(room);
    if (!periodic || previous?.key !== key || this.isAnimating(snapshot)) {
      this.sent.set(room, { key, settled: false });
      return false;
    }
    if (previous.settled) {
      return true;
    }
    // One unchanged snapshot lets clients finish walk/attack/stun motions.
    previous.settled = true;
    return false;
  }

  // Raw fields can stay equal while the rendered motion still depends on tick.
  private isAnimating(snapshot: Snapshot): boolean {
    const { tick, rules, players, projectiles, effects } = snapshot.world;
    if (
      snapshot.chats.length > 0 ||
      projectiles.length > 0 ||
      effects.length > 0
    ) {
      return true;
    }
    return players.some(
      (player) =>
        tick < player.knockbackUntilTick ||
        tick < player.stunnedUntilTick ||
        tick < player.invulnerableUntilTick ||
        tick < player.meleeReadyAtTick ||
        tick < player.stoneReadyAtTick ||
        (player.lastAction !== null &&
          (tick - player.lastAction.tick) * rules.tickMs <
            ATTACK_DISPLAY_MS[player.lastAction.kind]),
    );
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
    this.publishSnapshot(room);
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
      this.publishSnapshot(result.room);
    }
  }
}
