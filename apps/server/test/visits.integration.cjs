const request = require('supertest');
const { io } = require('socket.io-client');
const { randomBytes, randomUUID } = require('node:crypto');

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
beforeAll(async () => {
  const { createApp } = await import('../dist/app.mjs');
  app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  api = request(app.getHttpServer());
});
afterAll(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  if (app) {
    const { Database } = await import('../dist/app.mjs');
    const db = app.get(Database);
    await db.inviteToken.deleteMany({
      where: { room: { ownerDeviceId: { in: createdDevices } } },
    });
    await db.hostRoom.deleteMany({
      where: { ownerDeviceId: { in: createdDevices } },
    });
    await db.deviceIdentity.deleteMany({
      where: { id: { in: createdDevices } },
    });
    await app.close();
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
    auth: { version: 1, token: user.accessToken },
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

async function openPair(focused = false) {
  const host = await register('M3 호스트');
  const guest = await register('M3 방문자');
  const hs = await connect(host);
  const gs = await connect(guest);
  const hosted = await ack(hs, 'room:host', {
    version: 1,
    bounds: { width: 1280, height: 720 },
    focused,
  });
  expect(hosted.ok).toBe(true);
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const join = {
    version: 1,
    token: new URL(invitation.link).pathname.slice(6),
  };
  return { host, guest, hs, gs, hosted, join };
}

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
    version: 1,
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
    version: 1,
    bounds: { width: 1280, height: 720 },
  });
  expect(hosted.ok).toBe(true);
  const first = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const second = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const guest = await register('방문자');
  const gs = await connect(guest);
  const token = (link) => new URL(link).pathname.slice(6);
  expect(
    (await ack(gs, 'visit:join', { version: 1, token: token(first.link) }))
      .code,
  ).toBe('INVALID_INVITE');
  const joined = await ack(gs, 'visit:join', {
    version: 1,
    token: token(second.link),
  });
  expect(joined.ok).toBe(true);
  expect(JSON.stringify(joined.snapshot)).not.toContain(host.secret);
  await apiFor(host).delete('/v1/rooms/me/invites/current');
  const repeated = await ack(gs, 'visit:join', {
    version: 1,
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

test('two clients share authoritative hits, enforce capacity and room isolation, and close on host disconnect', async () => {
  const host = await register('모찌'),
    guest = await register('민트'),
    third = await register('세번째');
  const hs = await connect(host),
    gs = await connect(guest),
    ts = await connect(third);
  const outsideSnapshots = [];
  ts.on('world:snapshot', (snapshot) => outsideSnapshots.push(snapshot));
  const hosted = await ack(hs, 'room:host', {
    version: 1,
    bounds: { width: 1280, height: 720 },
  });
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const join = {
    version: 1,
    token: new URL(invitation.link).pathname.slice(6),
  };
  expect((await ack(hs, 'visit:join', join)).code).toBe('SELF_VISIT');
  const entered = await ack(gs, 'visit:join', join);
  expect(entered.ok).toBe(true);
  const repeated = await ack(gs, 'visit:join', join);
  expect(repeated.visitId).toBe(entered.visitId);
  expect(repeated.snapshot.world.players).toHaveLength(2);
  expect((await ack(ts, 'visit:join', join)).code).toBe('ROOM_FULL');
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
