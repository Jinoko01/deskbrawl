const request = require('supertest');
const { io } = require('socket.io-client');
const { Buffer } = require('node:buffer');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');

// This suite requires an isolated PostgreSQL database with migrations applied.
if (
  !process.env.TEST_DATABASE_URL ||
  !/test/i.test(new URL(process.env.TEST_DATABASE_URL).pathname)
) {
  throw new Error(
    'Set TEST_DATABASE_URL to an isolated database whose name contains test',
  );
}
let app, base, api;
const sockets = [];
const createdDevices = [];
const config = {
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  JWT_SECRET: randomBytes(32).toString('hex'),
  PORT: 3000,
  PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  CLIENT_ORIGINS: 'http://127.0.0.1:1420',
  origins: ['http://127.0.0.1:1420'],
  ACCESS_TTL_SECONDS: 3600,
  INVITE_TTL_SECONDS: 3600,
};
beforeEach(async () => {
  sockets.length = 0;
  createdDevices.length = 0;
  const { createApp } = await import('../dist/app.mjs');
  app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  api = request(app.getHttpServer());
});
afterEach(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  if (app) {
    const { Database } = await import('../dist/app.mjs');
    const db = app.get(Database);
    try {
      await db.inviteToken.deleteMany({
        where: { room: { ownerDeviceId: { in: createdDevices } } },
      });
      await db.hostRoom.deleteMany({
        where: { ownerDeviceId: { in: createdDevices } },
      });
      await db.deviceIdentity.deleteMany({
        where: { id: { in: createdDevices } },
      });
    } finally {
      await app.close();
    }
  }
});
const apiFor = (user) => ({
  post: (path) =>
    api.post(path).set('Authorization', `Bearer ${user.accessToken}`),
  get: (path) =>
    api.get(path).set('Authorization', `Bearer ${user.accessToken}`),
  delete: (path) =>
    api.delete(path).set('Authorization', `Bearer ${user.accessToken}`),
});
async function register(nickname) {
  const response = await api.post('/v1/devices').send({ nickname });
  expect(response.status).toBe(201);
  createdDevices.push(response.body.deviceId);
  return response.body;
}
async function connect(user, extra = {}) {
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
    auth: { version: 2, token: user.accessToken },
    ...extra,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  return socket;
}
function ack(socket, event, body) {
  return socket.timeout(3000).emitWithAck(event, body);
}
// Same claims as AuthService.issue(), with a caller-chosen expiry (seconds).
function signAccessToken(deviceId, exp) {
  const part = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({
    sub: deviceId,
    iss: 'deskbrawl',
    aud: 'deskbrawl-desktop',
    iat: Math.floor(Date.now() / 1000),
    exp,
  })}`;
  const signature = createHmac('sha256', config.JWT_SECRET)
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}
function disconnected(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for disconnect')),
      timeoutMs,
    );
    socket.once('disconnect', () => {
      clearTimeout(timeout);
      resolve(Date.now());
    });
  });
}
async function hostRoom(socket) {
  return ack(socket, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
}
function until(socket, event, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 5000);
    function listener(body) {
      if (predicate(body)) {
        clearTimeout(timeout);
        socket.off(event, listener);
        resolve(body);
      }
    }
    socket.on(event, listener);
  });
}

test('negotiated HP preserves legacy snapshots and broadcasts knockout and recovery at fixed ticks', async () => {
  const host = await register('HP host');
  const guest = await register('HP guest');
  const hs = await connect(host);
  const gs = await connect(guest, {
    auth: { version: 2, token: guest.accessToken, health: true },
  });
  const hosted = await ack(hs, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
  expect(hosted.snapshot.world.players[0]).not.toHaveProperty('hp');
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const entered = await ack(gs, 'visit:join', {
    version: 2,
    token: new URL(invitation.link).pathname.slice(6),
  });
  expect(
    entered.snapshot.world.players.every((player) => player.hp === 50),
  ).toBe(true);

  const { SimulationEngine } = await import('../dist/app.mjs');
  const engine = app.get(SimulationEngine);
  const room = engine.rooms.get(hosted.roomId);
  room.focused = true;
  const attacker = room.world.players.find(
    (player) => player.id === host.deviceId,
  );
  room.world = {
    ...room.world,
    players: room.world.players.map((player) =>
      player.id === guest.deviceId
        ? {
            ...player,
            hp: 3,
            position: { x: attacker.position.x + 70, y: attacker.position.y },
          }
        : player,
    ),
  };
  const step = (count) => {
    room.focused = false;
    for (let index = 0; index < count; index++) {
      engine.step(room);
    }
    room.focused = true;
    engine.onSnapshot(room);
  };
  room.focused = false;
  engine.action(room, room.members.get(host.deviceId), {
    visitId: hosted.visitId,
    actionId: randomUUID(),
    action: 'melee',
  });
  room.focused = true;
  const hitTick = room.world.tick + 1;
  const knockedOut = until(
    gs,
    'world:snapshot',
    (snapshot) => snapshot.world.tick === hitTick,
  );
  const legacy = until(
    hs,
    'world:snapshot',
    (snapshot) => snapshot.world.tick === hitTick,
  );
  step(1);
  const hit = (await knockedOut).world.players.find(
    (player) => player.id === guest.deviceId,
  );
  expect(hit.hp).toBe(0);
  expect(hit.stunnedUntilTick).toBe(hitTick + 60);
  expect(
    (await legacy).world.players.every((player) => !('hp' in player)),
  ).toBe(true);
  step(59);
  expect(
    room.world.players.find((player) => player.id === guest.deviceId).hp,
  ).toBe(0);
  const recovered = until(
    gs,
    'world:snapshot',
    (snapshot) => snapshot.world.tick === hitTick + 60,
  );
  step(1);
  expect(
    (await recovered).world.players.find(
      (player) => player.id === guest.deviceId,
    ).hp,
  ).toBe(50);
});

async function openPair(focused = false) {
  const host = await register('M3 호스트');
  const guest = await register('M3 방문자');
  const hs = await connect(host);
  const gs = await connect(guest);
  const hosted = await ack(hs, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
    focused,
  });
  expect(hosted.ok).toBe(true);
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const join = {
    version: 2,
    token: new URL(invitation.link).pathname.slice(6),
  };
  return { host, guest, hs, gs, hosted, join };
}

test('WORK position commands synchronize only the sender and reject PLAY and another visit', async () => {
  const { host, guest, hs, gs, hosted, join } = await openPair();
  const entered = await ack(gs, 'visit:join', join);
  expect(
    (
      await ack(hs, 'player:mode', {
        visitId: hosted.visitId,
        seq: 1,
        playing: false,
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await ack(gs, 'player:position', {
        visitId: hosted.visitId,
        seq: 1,
        position: { x: 300, y: 200 },
      })
    ).code,
  ).toBe('SESSION_ENDED');
  const positioned = until(gs, 'world:snapshot', (snapshot) =>
    snapshot.world.players.some(
      (player) =>
        player.id === host.deviceId &&
        player.position.x === 300 &&
        player.position.y === 200,
    ),
  );
  expect(
    (
      await ack(hs, 'player:position', {
        visitId: hosted.visitId,
        seq: 2,
        position: { x: 300, y: 200 },
      })
    ).ok,
  ).toBe(true);
  const snapshot = await positioned;
  expect(
    snapshot.world.players.find((player) => player.id === guest.deviceId)
      .position,
  ).toEqual(
    entered.snapshot.world.players.find(
      (player) => player.id === guest.deviceId,
    ).position,
  );
  expect(
    (
      await ack(hs, 'player:position', {
        visitId: hosted.visitId,
        seq: 3,
        position: { x: -1, y: 200 },
      })
    ).code,
  ).toBe('INVALID_INPUT');
  expect(
    (
      await ack(hs, 'player:mode', {
        visitId: hosted.visitId,
        seq: 3,
        playing: true,
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await ack(hs, 'player:position', {
        visitId: hosted.visitId,
        seq: 4,
        position: { x: 500, y: 200 },
      })
    ).code,
  ).toBe('INVALID_INPUT');
});

test('host-only kick and clear immediately reject old sessions and duplicate commands cannot evict a new visit', async () => {
  const { host, guest, hs, gs, hosted, join } = await openPair();
  const entered = await ack(gs, 'visit:join', join);
  const kick = {
    visitId: hosted.visitId,
    commandId: randomUUID(),
    targetPlayerId: guest.deviceId,
  };
  expect(
    (await ack(gs, 'visit:kick', { ...kick, visitId: entered.visitId })).code,
  ).toBe('UNAUTHORIZED');
  expect(
    (await ack(hs, 'visit:kick', { ...kick, targetPlayerId: host.deviceId }))
      .code,
  ).toBe('INVALID_INPUT');
  const kicked = until(gs, 'room:closed', (body) => body.code === 'KICKED');
  expect((await ack(hs, 'visit:kick', kick)).ok).toBe(true);
  await kicked;
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: entered.visitId,
        seq: 1,
        movement: { x: 1, y: 0 },
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(
    (
      await ack(gs, 'player:action', {
        visitId: entered.visitId,
        actionId: randomUUID(),
        action: 'stone',
      })
    ).code,
  ).toBe('SESSION_ENDED');
  const rejoined = await ack(gs, 'visit:join', join);
  expect(rejoined.visitId).not.toBe(entered.visitId);
  expect((await ack(hs, 'visit:kick', kick)).ok).toBe(true);
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: rejoined.visitId,
        seq: 1,
        movement: { x: 0, y: 0 },
      })
    ).ok,
  ).toBe(true);
  expect(
    (await ack(hs, 'visit:kick', { ...kick, targetPlayerId: randomUUID() }))
      .code,
  ).toBe('INVALID_INPUT');
  const clear = { visitId: hosted.visitId, commandId: randomUUID() };
  const cleared = until(gs, 'room:closed', (body) => body.code === 'KICKED');
  expect((await ack(hs, 'visit:clear', clear)).ok).toBe(true);
  await cleared;
  const afterClear = await ack(gs, 'visit:join', join);
  expect((await ack(hs, 'visit:clear', clear)).ok).toBe(true);
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: afterClear.visitId,
        seq: 1,
        movement: { x: 0, y: 0 },
      })
    ).ok,
  ).toBe(true);
  gs.disconnect();
  hs.disconnect();
});

test('focus closes existing visits, blocks joins and input, keeps links, and serializes invitation races', async () => {
  const { host, guest, hs, gs, hosted, join } = await openPair(true);
  expect((await ack(gs, 'visit:join', join)).code).toBe('ROOM_UNAVAILABLE');
  const focus = (focused) => ({
    visitId: hosted.visitId,
    commandId: randomUUID(),
    focused,
  });
  expect((await ack(hs, 'room:focus', focus(false))).ok).toBe(true);
  const entered = await ack(gs, 'visit:join', join);
  const closed = until(
    gs,
    'room:closed',
    (body) => body.code === 'ROOM_UNAVAILABLE',
  );
  const enabled = focus(true);
  expect((await ack(hs, 'room:focus', enabled)).ok).toBe(true);
  await closed;
  expect(
    (
      await ack(hs, 'player:action', {
        visitId: hosted.visitId,
        actionId: randomUUID(),
        action: 'stone',
      })
    ).code,
  ).toBe('ROOM_UNAVAILABLE');
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: entered.visitId,
        seq: 1,
        movement: { x: 1, y: 0 },
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect((await ack(gs, 'visit:join', join)).code).toBe('ROOM_UNAVAILABLE');
  expect((await ack(hs, 'room:focus', focus(false))).ok).toBe(true);
  // A repeated old focus command must not enable focus again after it was disabled.
  expect((await ack(hs, 'room:focus', enabled)).ok).toBe(true);
  expect((await ack(gs, 'visit:join', join)).ok).toBe(true);
  const ending = until(
    gs,
    'room:closed',
    (body) => body.code === 'ROOM_UNAVAILABLE',
  );
  const [, rotated] = await Promise.all([
    ack(hs, 'room:focus', focus(true)),
    apiFor(host).post('/v1/rooms/me/invites'),
  ]);
  await ending;
  expect((await ack(gs, 'visit:join', join)).code).toBe('INVALID_INVITE');
  const replacement = {
    version: 2,
    token: new URL(rotated.body.link).pathname.slice(6),
  };
  // Use a new transport to keep the test's join rate below the public limit.
  gs.disconnect();
  const reconnected = await connect(guest);
  expect((await ack(reconnected, 'visit:join', replacement)).code).toBe(
    'ROOM_UNAVAILABLE',
  );
  expect((await ack(hs, 'room:focus', focus(false))).ok).toBe(true);
  const [racingJoin, racingFocus] = await Promise.all([
    ack(reconnected, 'visit:join', replacement),
    ack(hs, 'room:focus', focus(true)),
  ]);
  expect(racingFocus.ok).toBe(true);
  if (!racingJoin.ok) {
    expect(['ROOM_UNAVAILABLE', 'SESSION_ENDED']).toContain(racingJoin.code);
  }
  const { VisitSessionService } = await import('../dist/app.mjs');
  const state = app.get(VisitSessionService).find(hs.id);
  expect(state.room.members.size).toBe(1);
  expect(state.room.focused).toBe(true);
  reconnected.disconnect();
  hs.disconnect();
});

test('REST authentication, private identity, origin checks, invitation rotation and revocation', async () => {
  const malformed = await api
    .post('/v1/devices')
    .set('Content-Type', 'application/json')
    .send('{');
  expect(malformed.status).toBe(400);
  expect(malformed.body.code).toBe('INVALID_INPUT');
  const oversized = await api
    .post('/v1/devices')
    .send({ nickname: 'x'.repeat(9000) });
  expect(oversized.status).toBe(413);
  expect(oversized.body.code).toBe('INVALID_INPUT');
  const host = await register('호스트');
  expect((await api.get('/v1/rooms/me')).status).toBe(401);
  const own = await apiFor(host).get('/v1/rooms/me');
  expect(own.body.ownerDeviceId).toBe(host.deviceId);
  const restored = await api
    .post('/v1/devices/session')
    .send({ deviceId: host.deviceId, secret: host.secret });
  expect(restored.body.deviceId).toBe(host.deviceId);
  expect(
    (
      await api
        .post('/v1/devices/session')
        .send({ deviceId: host.deviceId, secret: 'x'.repeat(43) })
    ).status,
  ).toBe(401);
  await expect(
    connect(host, { extraHeaders: { Origin: 'https://evil.example' } }),
  ).rejects.toThrow('UNAUTHORIZED');
  await expect(connect({ accessToken: 'invalid' })).rejects.toThrow(
    'UNAUTHORIZED',
  );
  const socket = await connect(host);
  const hosted = await ack(socket, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
  expect(hosted.ok).toBe(true);
  const first = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const second = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const guest = await register('방문자');
  const gs = await connect(guest);
  const token = (link) => new URL(link).pathname.slice(6);
  expect(
    (await ack(gs, 'visit:join', { version: 2, token: token(first.link) }))
      .code,
  ).toBe('INVALID_INVITE');
  const joined = await ack(gs, 'visit:join', {
    version: 2,
    token: token(second.link),
  });
  expect(joined.ok).toBe(true);
  expect(JSON.stringify(joined.snapshot)).not.toContain(host.secret);
  await apiFor(host).delete('/v1/rooms/me/invites/current');
  const repeated = await ack(gs, 'visit:join', {
    version: 2,
    token: token(second.link),
  });
  expect(repeated.code).toBe('INVALID_INVITE');
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: joined.visitId,
        seq: 1,
        movement: { x: 0, y: 0 },
      })
    ).ok,
  ).toBe(true);
  gs.disconnect();
  socket.disconnect();
});

test('two clients share authoritative hits, enforce room isolation, and close on explicit host leave', async () => {
  const host = await register('모찌'),
    guest = await register('민트'),
    third = await register('세번째');
  const hs = await connect(host),
    gs = await connect(guest),
    ts = await connect(third);
  const outsideSnapshots = [];
  ts.on('world:snapshot', (snapshot) => outsideSnapshots.push(snapshot));
  const hosted = await ack(hs, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const join = {
    version: 2,
    token: new URL(invitation.link).pathname.slice(6),
  };
  expect((await ack(hs, 'visit:join', join)).code).toBe('SELF_VISIT');
  const entered = await ack(gs, 'visit:join', join);
  expect(entered.ok).toBe(true);
  const repeated = await ack(gs, 'visit:join', join);
  expect(repeated.visitId).toBe(entered.visitId);
  expect(repeated.snapshot.world.players).toHaveLength(2);
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: hosted.visitId,
        seq: 1,
        movement: { x: 1, y: 0 },
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: entered.visitId,
        seq: 1,
        movement: { x: 999, y: 0 },
      })
    ).code,
  ).toBe('INVALID_INPUT');
  const hitPredicate = (s) =>
    s.world.players.some(
      (p) => p.id === guest.deviceId && p.lastHitTick !== null,
    );
  const hostHit = until(hs, 'world:snapshot', hitPredicate),
    guestHit = until(gs, 'world:snapshot', hitPredicate);
  const action = {
    visitId: hosted.visitId,
    actionId: randomUUID(),
    action: 'stone',
  };
  expect((await ack(hs, 'player:action', action)).ok).toBe(true);
  expect((await ack(hs, 'player:action', action)).ok).toBe(true);
  const [a, b] = await Promise.all([hostHit, guestHit]);
  expect(a).toEqual(b);
  expect(
    a.world.players.find((p) => p.id === guest.deviceId).stunnedUntilTick,
  ).toBeGreaterThan(a.world.tick);
  expect(outsideSnapshots).toHaveLength(0);
  const closed = until(gs, 'room:closed', () => true);
  expect((await ack(hs, 'visit:leave', { visitId: hosted.visitId })).ok).toBe(
    true,
  );
  hs.disconnect();
  expect((await closed).code).toBe('HOST_OFFLINE');
  expect(
    (
      await ack(gs, 'player:input', {
        visitId: entered.visitId,
        seq: 2,
        movement: { x: 0, y: 0 },
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect((await ack(ts, 'visit:join', join)).code).toBe('HOST_OFFLINE');
  gs.disconnect();
  ts.disconnect();
});

// Collects snapshots for a bounded window instead of waiting for silence forever.
async function collect(socket, ms) {
  const received = [];
  const listener = (snapshot) => received.push(snapshot);
  socket.on('world:snapshot', listener);
  await new Promise((resolve) => setTimeout(resolve, ms));
  socket.off('world:snapshot', listener);
  return received;
}

test('idle snapshots are skipped only for opted-in sockets and resume on changes, motions and explicit events', async () => {
  const host = await register('Idle host');
  const guest = await register('Legacy guest');
  const hs = await connect(host, {
    auth: {
      version: 2,
      token: host.accessToken,
      health: true,
      idleSnapshots: true,
    },
  });
  const gs = await connect(guest);
  const hosted = await ack(hs, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const entered = await ack(gs, 'visit:join', {
    version: 2,
    token: new URL(invitation.link).pathname.slice(6),
  });
  expect(entered.ok).toBe(true);
  const { SimulationEngine } = await import('../dist/app.mjs');
  const room = app.get(SimulationEngine).rooms.get(hosted.roomId);
  const hostPlayer = (snapshot) =>
    snapshot.world.players.find((player) => player.id === host.deviceId);

  // Mixed room: the legacy guest keeps 20 Hz, the opted-in host goes quiet.
  await collect(hs, 200);
  const tickBefore = room.world.tick;
  const [quietHost, legacyGuest] = await Promise.all([
    collect(hs, 600),
    collect(gs, 600),
  ]);
  expect(quietHost).toHaveLength(0);
  expect(legacyGuest.length).toBeGreaterThanOrEqual(8);
  expect(legacyGuest[0].world.players[0]).not.toHaveProperty('hp');
  expect(room.world.tick - tickBefore).toBeGreaterThanOrEqual(8);

  // Movement: applied sequence and every step arrive, then one settling frame.
  const moving = collect(hs, 900);
  expect(
    (
      await ack(hs, 'player:input', {
        visitId: hosted.visitId,
        seq: 1,
        movement: { x: 1, y: 0 },
      })
    ).ok,
  ).toBe(true);
  const moved = await moving;
  expect(moved[0].lastProcessedSeq[host.deviceId]).toBe(1);
  const xs = moved.map((snapshot) => hostPlayer(snapshot).position.x);
  expect(xs.at(-1)).toBe(xs.at(-2));
  expect(new Set(xs.slice(0, -1)).size).toBe(xs.length - 1);
  expect(await collect(hs, 300)).toHaveLength(0);

  // A repeated input that does not move still delivers its new sequence.
  const held = until(
    hs,
    'world:snapshot',
    (snapshot) => snapshot.lastProcessedSeq[host.deviceId] === 2,
  );
  await ack(hs, 'player:input', {
    visitId: hosted.visitId,
    seq: 2,
    movement: { x: 0, y: 0 },
  });
  await held;
  await collect(hs, 200);

  // Attack: snapshots continue through the motion and cooldown boundaries.
  const attacking = collect(hs, 1200);
  await ack(hs, 'player:action', {
    visitId: hosted.visitId,
    actionId: randomUUID(),
    action: 'melee',
  });
  const attack = await attacking;
  const acted = attack.find((snapshot) => hostPlayer(snapshot).lastAction);
  const { tick: actionTick } = hostPlayer(acted).lastAction;
  const ticks = attack.map((snapshot) => snapshot.world.tick);
  for (const boundary of [actionTick + 8, hostPlayer(acted).meleeReadyAtTick]) {
    expect(ticks).toContain(boundary);
  }
  expect(ticks.at(-1)).toBe(hostPlayer(acted).meleeReadyAtTick);
  expect(await collect(hs, 300)).toHaveLength(0);

  // Chat stays on the periodic path until it is removed.
  await ack(hs, 'player:chat', {
    visitId: hosted.visitId,
    seq: 1,
    current: '안녕',
    previous: '',
  });
  expect((await collect(hs, 300)).length).toBeGreaterThanOrEqual(4);
  const cleared = collect(hs, 400);
  await ack(hs, 'player:chat', {
    visitId: hosted.visitId,
    seq: 2,
    current: '',
    previous: '',
  });
  const afterClear = await cleared;
  expect(afterClear.at(-1).chats).toEqual([]);
  expect(afterClear.length).toBeLessThanOrEqual(4);
  expect(await collect(hs, 300)).toHaveLength(0);

  // Explicit events send the full current state even while idle.
  const renamed = until(hs, 'world:snapshot', (snapshot) =>
    snapshot.members.some((member) => member.nickname === 'Renamed guest'),
  );
  await ack(gs, 'player:profile', {
    visitId: entered.visitId,
    nickname: 'Renamed guest',
  });
  await renamed;
  const departed = until(
    hs,
    'world:snapshot',
    (snapshot) => snapshot.members.length === 1,
  );
  await ack(gs, 'visit:leave', { visitId: entered.visitId });
  expect((await departed).world.players).toHaveLength(1);
});

test('commands reuse handshake authentication without per-command device lookups', async () => {
  const host = await register('Auth cache host');
  const hs = await connect(host);
  const hosted = await hostRoom(hs);
  const { Database } = await import('../dist/app.mjs');
  const db = app.get(Database);
  let lookups = 0;
  const find = db.deviceIdentity.findUnique.bind(db.deviceIdentity);
  db.deviceIdentity.findUnique = (args) => {
    if (args.select?.revokedAt === true) {
      lookups++;
    }
    return find(args);
  };
  for (let seq = 1; seq <= 20; seq++) {
    expect(
      (
        await ack(hs, 'player:input', {
          visitId: hosted.visitId,
          seq,
          movement: { x: 0, y: 0 },
        })
      ).ok,
    ).toBe(true);
  }
  expect(lookups).toBe(0);
});

test('revoking a connected device ends its connection within the check interval and blocks reconnects', async () => {
  const host = await register('Revoked host');
  const other = await register('Unrevoked device');
  const hs = await connect(host);
  const os = await connect(other);
  await hostRoom(hs);
  const { Database } = await import('../dist/app.mjs');
  const db = app.get(Database);
  const closed = disconnected(hs, 2500);
  await db.deviceIdentity.update({
    where: { id: host.deviceId },
    data: { revokedAt: new Date() },
  });
  await closed;
  expect(os.connected).toBe(true);
  await expect(connect(host)).rejects.toThrow('UNAUTHORIZED');
});

test('an expired access token is disconnected without waiting for reconnect', async () => {
  const host = await register('Expiring host');
  const exp = Math.floor(Date.now() / 1000) + 2;
  const hs = await connect(host, {
    auth: { version: 2, token: signAccessToken(host.deviceId, exp) },
  });
  const closed = disconnected(hs, 5000);
  expect((await hostRoom(hs)).role).toBe('host');
  expect(await closed).toBeGreaterThanOrEqual(exp * 1000);
  await expect(
    connect(host, {
      auth: { version: 2, token: signAccessToken(host.deviceId, exp) },
    }),
  ).rejects.toThrow('UNAUTHORIZED');
});

test('existing connections keep working while the batched device check fails', async () => {
  const host = await register('DB outage host');
  const hs = await connect(host);
  const hosted = await hostRoom(hs);
  const { Database } = await import('../dist/app.mjs');
  const db = app.get(Database);
  const findMany = db.deviceIdentity.findMany;
  let failures = 0;
  const failedTwice = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Device check did not run')),
      3500,
    );
    db.deviceIdentity.findMany = () => {
      if (++failures === 2) {
        clearTimeout(timeout);
        resolve();
      }
      return Promise.reject(new Error('database unavailable'));
    };
  });
  try {
    await failedTwice;
    expect(hs.connected).toBe(true);
    expect(
      (
        await ack(hs, 'player:input', {
          visitId: hosted.visitId,
          seq: 1,
          movement: { x: 0, y: 0 },
        })
      ).ok,
    ).toBe(true);
  } finally {
    db.deviceIdentity.findMany = findMany;
  }
});
