import { Inject, Injectable, Module } from "@nestjs/common";
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { OnGatewayInit, OnGatewayDisconnect } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { hostSchema, joinSchema, leaveSchema, inputSchema, playerActionSchema } from "@deskbrawl/protocol";
import type { Joined } from "@deskbrawl/protocol";
import { Database } from "../database";
import { CONFIG } from "../config";
import type { Config } from "../config";
import { DomainError, failure, RateLimit } from "../errors";
import { SimulationEngine, SimulationModule } from "../game/simulation";
import type { Member, RoomWorld } from "../game/simulation";
import { AuthService, hash } from "./auth";
import { RoomsModule, RoomsService } from "./rooms";

@Injectable()
export class VisitSessionService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(RoomsService) private readonly rooms: RoomsService, @Inject(SimulationEngine) readonly engine: SimulationEngine) {}
  private member(deviceId: string, nickname: string, socketId: string, role: Member["role"]): Member {
    return { playerId: deviceId, nickname, socketId, role, visitId: randomUUID(), movement: { x: 0, y: 0 }, seq: 0, appliedSeq: 0, inputAtTick: 0, action: undefined, actionIds: [] };
  }
  find(socketId: string): { room: RoomWorld; member: Member } {
    for (const room of this.engine.rooms.values()) for (const member of room.members.values()) if (member.socketId === socketId) return { room, member };
    throw new DomainError("SESSION_ENDED");
  }
  joined(room: RoomWorld, member: Member): Joined { return { ok: true, roomId: room.roomId, worldId: room.worldId, visitId: member.visitId, playerId: member.playerId, role: member.role, snapshot: this.engine.snapshot(room) }; }
  async host(socket: Socket, deviceId: string, body: unknown): Promise<Joined> {
    const input = hostSchema.parse(body);
    return this.db.serialize(async () => {
      const roomInfo = await this.rooms.mine(deviceId);
      const existing = this.engine.rooms.get(roomInfo.id);
      if (existing !== undefined) {
        const member = existing.members.get(deviceId);
        if (member?.socketId === socket.id) return this.joined(existing, member);
        throw new DomainError("ALREADY_VISITING");
      }
      for (const room of this.engine.rooms.values()) if (room.members.has(deviceId)) throw new DomainError("ALREADY_VISITING");
      const device = await this.db.deviceIdentity.findUniqueOrThrow({ where: { id: deviceId } });
      if (!socket.connected) throw new DomainError("CONNECTION_LOST");
      const member = this.member(deviceId, device.nickname, socket.id, "host");
      const room = this.engine.open(roomInfo.id, input.bounds, member);
      return this.joined(room, member);
    });
  }
  async join(socket: Socket, deviceId: string, body: unknown): Promise<Joined> {
    const input = joinSchema.parse(body);
    return this.db.serialize(async () => {
      const invite = await this.db.inviteToken.findUnique({ where: { tokenHash: hash(input.token) }, include: { room: true } });
      if (invite === null || invite.expiresAt.getTime() <= Date.now()) throw new DomainError("INVALID_INVITE");
      if (invite.room.ownerDeviceId === deviceId) throw new DomainError("SELF_VISIT");
      const device = await this.db.deviceIdentity.findUniqueOrThrow({ where: { id: deviceId } });
      if (!socket.connected) throw new DomainError("CONNECTION_LOST");
      const room = this.engine.rooms.get(invite.hostRoomId);
      if (room === undefined) throw new DomainError("HOST_OFFLINE");
      const existing = room.members.get(deviceId);
      if (existing?.socketId === socket.id) return this.joined(room, existing);
      for (const active of this.engine.rooms.values()) if (active.members.has(deviceId)) throw new DomainError("ALREADY_VISITING");
      if (room.members.size >= invite.room.maxParticipants) throw new DomainError("ROOM_FULL");
      const member = this.member(deviceId, device.nickname, socket.id, "guest");
      member.inputAtTick = room.world.tick;
      this.engine.add(room, member);
      return this.joined(room, member);
    });
  }
  leave(socketId: string): { closed: boolean; room: RoomWorld } | undefined {
    let found;
    try { found = this.find(socketId); } catch { return; }
    const { room, member } = found;
    if (member.role === "host") { this.engine.rooms.delete(room.roomId); return { closed: true, room }; }
    this.engine.remove(room, member.playerId); return { closed: false, room };
  }
}

@WebSocketGateway({ transports: ["websocket"], maxHttpBufferSize: 8192 })
export class VisitsGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly limits = new RateLimit();
  private expiryTimer: ReturnType<typeof setInterval> | undefined;
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(VisitSessionService) private readonly sessions: VisitSessionService, @Inject(CONFIG) private readonly config: Config) {}
  afterInit(server: Server): void {
    this.sessions.engine.onSnapshot = (room) => { server.to(room.worldId).emit("world:snapshot", this.sessions.engine.snapshot(room)); };
    server.use((socket, next) => {
      void (async () => {
        this.limits.take(`connect:${socket.handshake.address}`, 20, 60000);
        const origin = socket.handshake.headers.origin;
        if (origin !== undefined && !this.config.origins.includes(origin)) throw new DomainError("UNAUTHORIZED");
        const auth: unknown = socket.handshake.auth;
        if (typeof auth !== "object" || auth === null || !("version" in auth) || auth.version !== 1) throw new DomainError("INCOMPATIBLE_VERSION");
        const token: unknown = "token" in auth ? auth.token : undefined;
        await this.auth.verify(token);
      })().then(() => next(), (error: unknown) => next(new Error(failure(error).code)));
    });
    // Token expiry/revocation must end idle sessions too.
    this.expiryTimer = setInterval(() => {
      for (const socket of server.sockets.sockets.values()) void this.authenticate(socket).catch(() => socket.disconnect(true));
    }, 1000);
  }
  onModuleDestroy(): void { if (this.expiryTimer !== undefined) clearInterval(this.expiryTimer); }
  private async authenticate(socket: Socket): Promise<string> {
    const auth: unknown = socket.handshake.auth;
    return this.auth.verify(typeof auth === "object" && auth !== null && "token" in auth ? auth.token : undefined);
  }
  private async command<T>(socket: Socket, limit: number, kind: string, operation: (device: string) => Promise<T> | T) {
    try {
      this.limits.take(`${kind}:${socket.id}`, limit);
      const device = await this.authenticate(socket);
      if (!socket.connected) throw new DomainError("CONNECTION_LOST");
      return await operation(device);
    } catch (error) { return failure(error); }
  }
  private async enter(socket: Socket, joined: Joined): Promise<Joined> {
    if (!socket.connected) { this.handleDisconnect(socket); throw new DomainError("CONNECTION_LOST"); }
    await socket.join(joined.worldId);
    socket.emit("visit:joined", joined);
    const { room } = this.sessions.find(socket.id);
    this.server.to(room.worldId).emit("world:snapshot", this.sessions.engine.snapshot(room));
    return joined;
  }
  @SubscribeMessage("room:host") host(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, 5, "join", async (device) => this.enter(socket, await this.sessions.host(socket, device, body)));
  }
  @SubscribeMessage("visit:join") join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, 5, "join", async (device) => this.enter(socket, await this.sessions.join(socket, device, body)));
  }
  @SubscribeMessage("visit:leave") leave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, 10, "leave", () => {
      const input = leaveSchema.parse(body);
      const { member } = this.sessions.find(socket.id);
      if (input.visitId !== member.visitId) throw new DomainError("SESSION_ENDED");
      this.handleDisconnect(socket); return { ok: true as const };
    });
  }
  @SubscribeMessage("player:input") input(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, 40, "input", () => { const command = inputSchema.parse(body); const { room, member } = this.sessions.find(socket.id); this.sessions.engine.input(room, member, command); return { ok: true as const }; });
  }
  @SubscribeMessage("player:action") action(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    return this.command(socket, 10, "action", () => { const command = playerActionSchema.parse(body); const { member } = this.sessions.find(socket.id); this.sessions.engine.action(member, command); return { ok: true as const }; });
  }
  handleDisconnect(socket: Socket): void {
    const result = this.sessions.leave(socket.id);
    if (result === undefined) return;
    void socket.leave(result.room.worldId);
    if (result.closed) { this.server.to(result.room.worldId).emit("room:closed", { ok: false, code: "HOST_OFFLINE" }); this.server.in(result.room.worldId).socketsLeave(result.room.worldId); }
    else this.server.to(result.room.worldId).emit("world:snapshot", this.sessions.engine.snapshot(result.room));
  }
}
@Module({ imports: [RoomsModule, SimulationModule], providers: [VisitSessionService, VisitsGateway] })
export class VisitsModule {}
