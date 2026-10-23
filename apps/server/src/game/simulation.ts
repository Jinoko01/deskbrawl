import type {
  PlayerInput,
  WorldBounds,
  WorldState,
  Vector2,
} from '@deskbrawl/game-core';
import { advance, createWorld, DEFAULT_COMBAT } from '@deskbrawl/game-core';
import type {
  Action,
  CharacterSkin,
  Chat,
  Input,
  Snapshot,
} from '@deskbrawl/protocol';
import { PROTOCOL_VERSION } from '@deskbrawl/protocol';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain.error';

const TICK_MS = 50;
const SCHEDULER_INTERVAL_MS = 25;
const MAX_CATCH_UP_MS = 250;
const MAX_INPUT_AGE_TICKS = 5;
const ACTION_HISTORY_LIMIT = 128;

export interface Member {
  playerId: string;
  nickname: string;
  skin?: CharacterSkin;
  role: 'host' | 'guest';
  socketId: string;
  visitId: string;
  resumeToken: string;
  disconnectExpiresAt: number | undefined;
  movement: PlayerInput['movement'];
  seq: number;
  appliedSeq: number;
  inputAtTick: number;
  action: PlayerInput['action'];
  actionIds: string[];
  chatSeq: number;
  working?: boolean;
  controlSeq?: number;
  pendingPosition?: Vector2 | undefined;
}
export interface RoomWorld {
  roomId: string;
  worldId: string;
  world: WorldState;
  members: Map<string, Member>;
  focused: boolean;
  controlCommands: Map<string, string>;
  chats: Map<string, Snapshot['chats'][number]>;
}
@Injectable()
export class SimulationEngine implements OnModuleInit, OnModuleDestroy {
  readonly rooms = new Map<string, RoomWorld>();
  onSnapshot: (room: RoomWorld) => void = () => {};
  private timer: ReturnType<typeof setInterval> | undefined;
  private previousTimeMs: number | undefined;
  private accumulatedMs = 0;

  onModuleInit(): void {
    this.timer = setInterval(
      () => this.advanceTime(performance.now()),
      SCHEDULER_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
    this.rooms.clear();
  }

  open(roomId: string, bounds: WorldBounds, member: Member): RoomWorld {
    const world = createWorld({
      bounds,
      rules: {
        tickMs: TICK_MS,
        moveSpeedUnitsPerSecond: 240,
        playerRadius: 24,
        combat: DEFAULT_COMBAT,
      },
      players: [
        {
          id: member.playerId,
          position: { x: bounds.width / 2 - 72, y: bounds.height / 2 },
        },
      ],
    });
    const room: RoomWorld = {
      roomId,
      worldId: randomUUID(),
      world,
      members: new Map([[member.playerId, member]]),
      focused: false,
      controlCommands: new Map(),
      chats: new Map(),
    };
    this.rooms.set(roomId, room);
    return room;
  }

  add(room: RoomWorld, member: Member): void {
    const player = createWorld({
      bounds: room.world.bounds,
      rules: room.world.rules,
      players: [
        {
          id: member.playerId,
          position: this.spawn(room),
        },
      ],
    }).players[0];
    if (player === undefined) {
      throw new Error('Missing player');
    }
    room.world = {
      ...room.world,
      players: [...room.world.players, { ...player, facing: { x: -1, y: 0 } }],
    };
    room.members.set(member.playerId, member);
  }

  private spawn(room: RoomWorld): { x: number; y: number } {
    const { width, height } = room.world.bounds;
    const radius = room.world.rules.playerRadius;
    const verticalSpacing = Math.min(128, (height - radius * 2) / 2);
    const candidates = [
      { x: width / 2 + 72, y: height / 2 },
      { x: width / 2 - 72, y: height / 2 },
      { x: width / 2 - 72, y: height / 2 - verticalSpacing },
      { x: width / 2 + 72, y: height / 2 - verticalSpacing },
      { x: width / 2 - 72, y: height / 2 + verticalSpacing },
      { x: width / 2 + 72, y: height / 2 + verticalSpacing },
    ];
    const isAvailable = (candidate: { x: number; y: number }): boolean =>
      room.world.players.every(
        (player) =>
          Math.hypot(
            player.position.x - candidate.x,
            player.position.y - candidate.y,
          ) >=
          radius * 2,
      );
    const position = candidates.find(isAvailable);
    if (position !== undefined) {
      return position;
    }
    for (let y = radius; y <= height - radius; y += radius * 2) {
      for (let x = radius; x <= width - radius; x += radius * 2) {
        if (isAvailable({ x, y })) {
          return { x, y };
        }
      }
    }
    throw new DomainError('ROOM_FULL');
  }

  remove(room: RoomWorld, playerId: string): void {
    room.members.delete(playerId);
    room.chats.delete(playerId);
    room.world = {
      ...room.world,
      players: room.world.players.filter((player) => player.id !== playerId),
      projectiles: room.world.projectiles.filter(
        (projectile) => projectile.ownerId !== playerId,
      ),
    };
  }

  input(room: RoomWorld, member: Member, input: Input): void {
    if (input.visitId !== member.visitId) {
      throw new DomainError('SESSION_ENDED');
    }
    if (room.focused) {
      throw new DomainError('ROOM_UNAVAILABLE');
    }
    if (input.seq <= member.seq) {
      return;
    }
    member.seq = input.seq;
    member.movement = member.working === true ? { x: 0, y: 0 } : input.movement;
    member.inputAtTick = room.world.tick;
  }

  action(room: RoomWorld, member: Member, command: Action): void {
    if (command.visitId !== member.visitId) {
      throw new DomainError('SESSION_ENDED');
    }
    if (room.focused) {
      throw new DomainError('ROOM_UNAVAILABLE');
    }
    if (member.working === true) {
      return;
    }
    if (member.actionIds.includes(command.actionId)) {
      return;
    }
    member.actionIds.push(command.actionId);
    if (member.actionIds.length > ACTION_HISTORY_LIMIT) {
      member.actionIds.shift();
    }
    // One pending action per member; do not accumulate old attacks through stalled frames.
    member.action ??= command.action;
  }

  setMode(
    room: RoomWorld,
    member: Member,
    seq: number,
    playing: boolean,
  ): void {
    if (seq <= (member.controlSeq ?? 0)) {
      return;
    }
    if (playing && room.focused) {
      throw new DomainError('ROOM_UNAVAILABLE');
    }
    member.controlSeq = seq;
    member.working = !playing;
    member.movement = { x: 0, y: 0 };
    member.action = undefined;
    member.pendingPosition = undefined;
  }

  place(room: RoomWorld, member: Member, seq: number, position: Vector2): void {
    if (seq <= (member.controlSeq ?? 0)) {
      return;
    }
    const player = room.world.players.find(
      (player) => player.id === member.playerId,
    );
    const radius = room.world.rules.playerRadius;
    if (
      room.focused ||
      member.working !== true ||
      player === undefined ||
      room.world.tick < player.stunnedUntilTick ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      position.x < radius ||
      position.x > room.world.bounds.width - radius ||
      position.y < radius ||
      position.y > room.world.bounds.height - radius
    ) {
      throw new DomainError('INVALID_INPUT');
    }
    member.controlSeq = seq;
    member.pendingPosition = { ...position };
  }

  chat(room: RoomWorld, member: Member, command: Chat, nowMs: number): void {
    if (command.visitId !== member.visitId) {
      throw new DomainError('SESSION_ENDED');
    }
    if (room.focused) {
      throw new DomainError('ROOM_UNAVAILABLE');
    }
    if (command.seq <= member.chatSeq) {
      return;
    }
    member.chatSeq = command.seq;
    if (command.current.length === 0 && command.previous.length === 0) {
      room.chats.delete(member.playerId);
      return;
    }
    room.chats.set(member.playerId, {
      playerId: member.playerId,
      current: command.current,
      previous: command.previous,
      updatedAt: nowMs,
    });
  }

  expireChats(room: RoomWorld, nowMs: number): void {
    for (const chat of room.chats.values()) {
      if (nowMs - chat.updatedAt >= 8000) {
        room.chats.delete(chat.playerId);
      }
    }
  }

  focus(room: RoomWorld, focused: boolean): void {
    room.focused = focused;
    room.chats.clear();
    for (const member of room.members.values()) {
      member.movement = { x: 0, y: 0 };
      member.action = undefined;
      member.pendingPosition = undefined;
      if (member.working !== undefined) {
        member.working = true;
      }
    }
    room.world = { ...room.world, projectiles: [], effects: [] };
  }

  step(room: RoomWorld): Snapshot {
    if (room.focused) {
      return this.snapshot(room);
    }
    room.world = {
      ...room.world,
      players: room.world.players.map((player) => {
        const member = room.members.get(player.id);
        const position = member?.pendingPosition;
        if (member !== undefined) {
          member.pendingPosition = undefined;
        }
        return position !== undefined &&
          member?.working === true &&
          room.world.tick >= player.stunnedUntilTick
          ? { ...player, position }
          : player;
      }),
    };
    const inputs = [...room.members.values()].map((member): PlayerInput => {
      const movement =
        room.world.tick - member.inputAtTick <= MAX_INPUT_AGE_TICKS
          ? member.movement
          : ({ x: 0, y: 0 } as const);
      const input = {
        playerId: member.playerId,
        movement,
        ...(member.action === undefined ? {} : { action: member.action }),
      };
      member.action = undefined;
      member.appliedSeq = member.seq;
      return input;
    });
    room.world = advance(room.world, inputs);
    return this.snapshot(room);
  }

  snapshot(room: RoomWorld): Snapshot {
    // Schema output is mutable; clone arrays at this wire boundary rather than expose engine state.
    return {
      version: PROTOCOL_VERSION,
      roomId: room.roomId,
      worldId: room.worldId,
      world: {
        ...room.world,
        players: room.world.players.map((player) => ({ ...player })),
        projectiles: room.world.projectiles.map((projectile) => ({
          ...projectile,
        })),
        effects: room.world.effects.map((effect) => ({ ...effect })),
      },
      chats: [...room.chats.values()].map((chat) => ({ ...chat })),
      members: [...room.members.values()].map(
        ({ playerId, nickname, role }) => ({ playerId, nickname, role }),
      ),
      lastProcessedSeq: Object.fromEntries(
        [...room.members.values()].map((member) => [
          member.playerId,
          member.appliedSeq,
        ]),
      ),
    };
  }

  advanceTime(nowMs: number): void {
    const elapsedMs =
      this.previousTimeMs === undefined
        ? 0
        : Math.max(0, nowMs - this.previousTimeMs);
    this.previousTimeMs = nowMs;
    // Drop excessive debt and stale held input instead of blocking Socket.IO heartbeats.
    if (elapsedMs > MAX_CATCH_UP_MS) {
      for (const room of this.rooms.values()) {
        for (const member of room.members.values()) {
          member.movement = { x: 0, y: 0 };
          member.action = undefined;
          member.pendingPosition = undefined;
        }
      }
    }
    this.accumulatedMs = Math.min(
      this.accumulatedMs + elapsedMs,
      MAX_CATCH_UP_MS,
    );
    while (this.accumulatedMs >= TICK_MS) {
      for (const room of this.rooms.values()) {
        if (room.focused) {
          continue;
        }
        this.step(room);
        this.onSnapshot(room);
      }
      this.accumulatedMs -= TICK_MS;
    }
  }
}
