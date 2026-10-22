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
  movement: { x: 0, y: 0 },
  seq: 0,
  appliedSeq: 0,
  inputAtTick: 0,
  action: undefined,
  actionIds: [],
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
