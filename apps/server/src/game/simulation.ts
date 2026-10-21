import { Injectable, Module } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { advance, createWorld, DEFAULT_COMBAT } from "@deskbrawl/game-core";
import type { PlayerInput, WorldBounds, WorldState } from "@deskbrawl/game-core";
import type { Action, Input, Snapshot } from "@deskbrawl/protocol";
import { DomainError } from "../errors";

export interface Member {
  playerId: string; nickname: string; role: "host" | "guest"; socketId: string; visitId: string;
  movement: PlayerInput["movement"]; seq: number; appliedSeq: number; inputAtTick: number;
  action: PlayerInput["action"]; actionIds: string[];
}
export interface RoomWorld { roomId: string; worldId: string; world: WorldState; members: Map<string, Member> }
@Injectable()
export class SimulationEngine implements OnModuleInit, OnModuleDestroy {
  readonly rooms = new Map<string, RoomWorld>();
  onSnapshot: (room: RoomWorld) => void = () => {};
  private timer: ReturnType<typeof setInterval> | undefined;
  private previous: number | undefined;
  private accumulator = 0;
  onModuleInit(): void { this.timer = setInterval(() => this.advanceTime(performance.now()), 25); }
  onModuleDestroy(): void { if (this.timer !== undefined) clearInterval(this.timer); this.rooms.clear(); }
  open(roomId: string, bounds: WorldBounds, member: Member): RoomWorld {
    const world = createWorld({ bounds, rules: { tickMs: 50, moveSpeedUnitsPerSecond: 240, playerRadius: 24, combat: DEFAULT_COMBAT },
      players: [{ id: member.playerId, position: { x: bounds.width / 2 - 72, y: bounds.height / 2 } }] });
    const room = { roomId, worldId: randomUUID(), world, members: new Map([[member.playerId, member]]) };
    this.rooms.set(roomId, room); return room;
  }
  add(room: RoomWorld, member: Member): void {
    const player = createWorld({ bounds: room.world.bounds, rules: room.world.rules,
      players: [{ id: member.playerId, position: { x: room.world.bounds.width / 2 + 72, y: room.world.bounds.height / 2 } }] }).players[0];
    if (player === undefined) throw new Error("Missing player");
    room.world = { ...room.world, players: [...room.world.players, { ...player, facing: { x: -1, y: 0 } }] };
    room.members.set(member.playerId, member);
  }
  remove(room: RoomWorld, playerId: string): void {
    room.members.delete(playerId);
    room.world = { ...room.world, players: room.world.players.filter((p) => p.id !== playerId), projectiles: room.world.projectiles.filter((p) => p.ownerId !== playerId) };
  }
  input(room: RoomWorld, member: Member, input: Input): void {
    if (input.visitId !== member.visitId) throw new DomainError("SESSION_ENDED");
    if (input.seq <= member.seq) return;
    member.seq = input.seq; member.movement = input.movement; member.inputAtTick = room.world.tick;
  }
  action(member: Member, command: Action): void {
    if (command.visitId !== member.visitId) throw new DomainError("SESSION_ENDED");
    if (member.actionIds.includes(command.actionId)) return;
    member.actionIds.push(command.actionId);
    if (member.actionIds.length > 128) member.actionIds.shift();
    // One pending action per member; do not accumulate old attacks through stalled frames.
    member.action ??= command.action;
  }
  step(room: RoomWorld): Snapshot {
    const inputs = [...room.members.values()].map((member): PlayerInput => {
      const movement = room.world.tick - member.inputAtTick <= 5 ? member.movement : { x: 0, y: 0 } as const;
      const input = { playerId: member.playerId, movement, ...(member.action === undefined ? {} : { action: member.action }) };
      member.action = undefined; member.appliedSeq = member.seq;
      return input;
    });
    room.world = advance(room.world, inputs);
    return this.snapshot(room);
  }
  snapshot(room: RoomWorld): Snapshot {
    // Schema output is mutable; clone arrays at this wire boundary rather than expose engine state.
    return { version: 1, roomId: room.roomId, worldId: room.worldId,
      world: { ...room.world, players: room.world.players.map((p) => ({ ...p })), projectiles: room.world.projectiles.map((p) => ({ ...p })), effects: room.world.effects.map((e) => ({ ...e })) },
      members: [...room.members.values()].map(({ playerId, nickname, role }) => ({ playerId, nickname, role })),
      lastProcessedSeq: Object.fromEntries([...room.members.values()].map((m) => [m.playerId, m.appliedSeq])) };
  }
  advanceTime(now: number): void {
    const elapsed = this.previous === undefined ? 0 : Math.max(0, now - this.previous);
    this.previous = now;
    // Drop excessive debt and stale held input instead of blocking Socket.IO heartbeats.
    if (elapsed > 250) for (const room of this.rooms.values()) for (const member of room.members.values()) { member.movement = { x: 0, y: 0 }; member.action = undefined; }
    this.accumulator = Math.min(this.accumulator + elapsed, 250);
    while (this.accumulator >= 50) {
      for (const room of this.rooms.values()) { this.step(room); this.onSnapshot(room); }
      this.accumulator -= 50;
    }
  }
}
@Module({ providers: [SimulationEngine], exports: [SimulationEngine] })
export class SimulationModule {}
