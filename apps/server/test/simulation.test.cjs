const { randomUUID } = require('node:crypto');
let SimulationEngine;
beforeAll(async () => {
  ({ SimulationEngine } = await import('../dist/app.mjs'));
});
const member = (role) => ({
  playerId: randomUUID(),
  nickname: role,
  role,
  socketId: randomUUID(),
  visitId: randomUUID(),
  resumeToken: 'a'.repeat(43),
  disconnectExpiresAt: undefined,
  movement: { x: 0, y: 0 },
  seq: 0,
  appliedSeq: 0,
  inputAtTick: 0,
  action: undefined,
  actionIds: [],
  chatSeq: 0,
});

test('fixed ticks apply queued input, reject old sessions and stop stale held input', () => {
  const engine = new SimulationEngine();
  const host = member('host');
  const room = engine.open(randomUUID(), { width: 1280, height: 720 }, host);
  const before = room.world.players[0].position.x;
  engine.input(room, host, {
    visitId: host.visitId,
    seq: 2,
    movement: { x: 1, y: 0 },
  });
  expect(room.world.players[0].position.x).toBe(before);
  engine.input(room, host, {
    visitId: host.visitId,
    seq: 1,
    movement: { x: -1, y: 0 },
  });
  expect(engine.step(room).lastProcessedSeq[host.playerId]).toBe(2);
  expect(room.world.players[0].position.x).toBe(before + 12);
  expect(() =>
    engine.input(room, host, {
      visitId: randomUUID(),
      resumeToken: 'a'.repeat(43),
      disconnectExpiresAt: undefined,
      seq: 3,
      movement: { x: 1, y: 0 },
    }),
  ).toThrow('SESSION_ENDED');
  for (let i = 0; i < 6; i++) {
    engine.step(room);
  }
  const settled = room.world.players[0].position.x;
  engine.step(room);
  expect(room.world.players[0].position.x).toBe(settled);
});
test('authoritative stone hit produces identical snapshots and duplicate action IDs cannot attack again', () => {
  const engine = new SimulationEngine();
  const host = member('host'),
    guest = member('guest');
  const room = engine.open(randomUUID(), { width: 1280, height: 720 }, host);
  engine.add(room, guest);
  const command = {
    visitId: host.visitId,
    actionId: randomUUID(),
    action: 'stone',
  };
  engine.action(room, host, command);
  for (let i = 0; i < 4; i++) {
    engine.step(room);
  }
  const hit = room.world.players.find((p) => p.id === guest.playerId);
  expect(hit.lastHitTick).not.toBeNull();
  expect(hit.stunnedUntilTick).toBeGreaterThan(room.world.tick);
  expect(engine.snapshot(room)).toEqual(engine.snapshot(room));
  const actionTick = room.world.players[0].lastAction.tick;
  for (let i = 0; i < 25; i++) {
    engine.step(room);
  }
  engine.action(room, host, command);
  engine.step(room);
  expect(room.world.players[0].lastAction.tick).toBe(actionTick);
  engine.remove(room, guest.playerId);
  expect(engine.snapshot(room).members).toHaveLength(1);
});
test('clock catch-up is bounded and cancels stale attacks', () => {
  const engine = new SimulationEngine();
  const host = member('host');
  const room = engine.open(randomUUID(), { width: 1280, height: 720 }, host);
  engine.advanceTime(0);
  engine.action(room, host, {
    visitId: host.visitId,
    actionId: randomUUID(),
    action: 'stone',
  });
  engine.advanceTime(10000);
  expect(room.world.tick).toBe(5);
  expect(room.world.projectiles).toHaveLength(0);
});

test('focus cancels queued movement and attacks and rejects input until resumed', () => {
  const engine = new SimulationEngine();
  const host = member('host');
  const room = engine.open(randomUUID(), { width: 1280, height: 720 }, host);
  const input = { visitId: host.visitId, seq: 1, movement: { x: 1, y: 0 } };
  const action = {
    visitId: host.visitId,
    actionId: randomUUID(),
    action: 'stone',
  };
  engine.input(room, host, input);
  engine.action(room, host, action);
  engine.focus(room, true);
  const paused = engine.snapshot(room);
  expect(() => engine.input(room, host, input)).toThrow('ROOM_UNAVAILABLE');
  expect(() => engine.action(room, host, action)).toThrow('ROOM_UNAVAILABLE');
  expect(engine.step(room)).toEqual(paused);
  engine.focus(room, false);
  engine.step(room);
  expect(room.world.players[0].position).toEqual(
    paused.world.players[0].position,
  );
  expect(room.world.projectiles).toHaveLength(0);
  expect(host.action).toBeUndefined();
});

test('six spawns remain separated on minimum bounds and a moved player cannot block the fixed entry slots', () => {
  const engine = new SimulationEngine();
  const host = member('host');
  const room = engine.open(randomUUID(), { width: 320, height: 200 }, host);
  for (let i = 0; i < 5; i++) {
    engine.add(room, member('guest'));
  }
  for (const a of room.world.players) {
    expect(a.position.x).toBeGreaterThanOrEqual(24);
    expect(a.position.y).toBeGreaterThanOrEqual(24);
    for (const b of room.world.players) {
      if (a.id !== b.id) {
        expect(
          Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y),
        ).toBeGreaterThanOrEqual(48);
      }
    }
  }
  engine.remove(room, room.world.players[5].id);
  const occupied = [
    { x: 88, y: 68 },
    { x: 232, y: 68 },
    { x: 88, y: 164 },
    { x: 232, y: 164 },
    { x: 160, y: 100 },
  ];
  room.world.players.forEach((player, index) => {
    player.position = occupied[index];
  });
  engine.add(room, member('guest'));
  expect(room.world.players).toHaveLength(6);
  const added = room.world.players[5];
  expect(added.position).toEqual({ x: 24, y: 24 });
  const desktop = engine.open(
    randomUUID(),
    { width: 1280, height: 720 },
    member('host'),
  );
  for (let index = 0; index < 5; index++) {
    engine.add(desktop, member('guest'));
  }
  expect(desktop.world.players[0].position).toEqual({ x: 568, y: 360 });
  expect(desktop.world.players[1].position).toEqual({ x: 712, y: 360 });
  expect(
    [...new Set(desktop.world.players.map((player) => player.position.y))].sort(
      (a, b) => a - b,
    ),
  ).toEqual([232, 360, 488]);
});

test('chat updates keep one current and previous line, ignore old sequence, expire and clear on focus', () => {
  const engine = new SimulationEngine();
  const host = member('host');
  const room = engine.open(randomUUID(), { width: 1280, height: 720 }, host);
  const message = {
    visitId: host.visitId,
    seq: 2,
    current: 'typing',
    previous: 'sent',
  };
  engine.chat(room, host, message, 1000);
  engine.chat(room, host, { ...message, seq: 1, current: 'old' }, 2000);
  expect(engine.snapshot(room).chats).toEqual([
    {
      playerId: host.playerId,
      current: 'typing',
      previous: 'sent',
      updatedAt: 1000,
    },
  ]);
  expect(() =>
    engine.chat(room, host, { ...message, visitId: randomUUID() }, 2000),
  ).toThrow('SESSION_ENDED');
  engine.expireChats(room, 8999);
  expect(engine.snapshot(room).chats).toHaveLength(1);
  engine.expireChats(room, 9000);
  expect(engine.snapshot(room).chats).toHaveLength(0);
  engine.chat(room, host, { ...message, seq: 3 }, 10000);
  engine.chat(
    room,
    host,
    { ...message, seq: 4, current: '', previous: '' },
    10000,
  );
  expect(engine.snapshot(room).chats).toHaveLength(0);
  engine.chat(room, host, { ...message, seq: 5 }, 11000);
  engine.focus(room, true);
  expect(engine.snapshot(room).chats).toHaveLength(0);
  expect(() => engine.chat(room, host, { ...message, seq: 6 }, 12000)).toThrow(
    'ROOM_UNAVAILABLE',
  );
});
