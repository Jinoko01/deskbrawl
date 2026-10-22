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

async function openRoom() {
  const host = await register('M4 host');
  const hs = await connect(host);
  const hosted = await ack(hs, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
  const invitation = (await apiFor(host).post('/v1/rooms/me/invites')).body;
  const join = {
    version: 2,
    token: new URL(invitation.link).pathname.slice(6),
  };
  return { host, hs, hosted, join };
}

test('database outages return a recoverable service status without leaking connection details', async () => {
  const { Database } = await import('../dist/app.mjs');
  const db = app.get(Database);
  const queryRaw = db.$queryRaw;
  db.$queryRaw = async () => {
    throw Object.assign(new Error('private database details'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } },
    });
  };
  try {
    const unavailable = await api.get('/health');
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ ok: false, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(unavailable.body)).not.toContain('private');
  } finally {
    db.$queryRaw = queryRaw;
  }
  expect((await api.get('/health')).status).toBe(200);
});

test('all eight selected characters are accepted for active profiles and broadcast to the room', async () => {
  const { host, hs, hosted } = await openRoom();
  const skins = [
    'mochi',
    'mint',
    'sunny',
    'coral',
    'lumi',
    'rusty',
    'byte',
    'berry',
  ];
  const { VisitSessionService } = await import('../dist/app.mjs');
  const service = app.get(VisitSessionService);
  let socket = hs;
  let own = hosted;
  for (const [index, skin] of skins.entries()) {
    // Fresh sockets keep this contract test independent of the 5/s profile limit.
    if (index > 0) {
      socket = await connect(host);
      own = await ack(socket, 'room:host', {
        version: 2,
        bounds: { width: 1280, height: 720 },
      });
    }
    const changed = until(socket, 'room:profiles', (body) =>
      body.profiles.some(
        (profile) =>
          profile.playerId === host.deviceId && profile.skin === skin,
      ),
    );
    expect(
      await ack(socket, 'player:profile', { visitId: own.visitId, skin }),
    ).toEqual({ ok: true });
    expect((await changed).worldId).toBe(own.worldId);
    expect(service.find(socket.id).member.skin).toBe(skin);
    expect(
      (await ack(socket, 'visit:leave', { visitId: own.visitId })).ok,
    ).toBe(true);
    socket.disconnect();
  }
});

async function sessions() {
  const { VisitSessionService } = await import('../dist/app.mjs');
  return app.get(VisitSessionService);
}

test('six authenticated participants share one world, seventh is rejected and outsiders see no snapshots', async () => {
  const { hs, hosted, join } = await openRoom();
  const guests = [];
  for (let index = 0; index < 5; index++) {
    const user = await register(`guest ${index}`);
    const socket = await connect(user);
    const entered = await ack(socket, 'visit:join', join);
    expect(entered.ok).toBe(true);
    expect(entered.worldId).toBe(hosted.worldId);
    guests.push({ socket, entered });
  }
  const snapshot = guests[4].entered.snapshot;
  expect(snapshot.members).toHaveLength(6);
  expect(snapshot.world.players).toHaveLength(6);
  for (const a of snapshot.world.players) {
    for (const b of snapshot.world.players) {
      if (a.id !== b.id) {
        expect(
          Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y),
        ).toBeGreaterThanOrEqual(48);
      }
    }
  }
  const outside = await connect(await register('outside'));
  const leaked = [];
  outside.on('world:snapshot', (body) => leaked.push(body));
  expect((await ack(outside, 'visit:join', join)).code).toBe('ROOM_FULL');
  await until(hs, 'world:snapshot', (body) => body.members.length === 6);
  expect(leaked).toHaveLength(0);
  const shared = until(guests[0].socket, 'world:snapshot', (body) =>
    body.chats.some((chat) => chat.current === 'live draft'),
  );
  expect(
    (
      await ack(hs, 'player:chat', {
        visitId: hosted.visitId,
        seq: 1,
        current: 'live draft',
        previous: 'last line',
      })
    ).ok,
  ).toBe(true);
  expect((await shared).chats[0].playerId).toBe(hosted.playerId);
  expect(
    (
      await ack(outside, 'player:chat', {
        visitId: hosted.visitId,
        seq: 1,
        current: 'spoof',
        previous: '',
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(
    (
      await ack(hs, 'player:chat', {
        visitId: hosted.visitId,
        seq: 2,
        current: 'x'.repeat(51),
        previous: '',
      })
    ).code,
  ).toBe('INVALID_INPUT');
  expect(leaked).toHaveLength(0);
  await ack(hs, 'visit:leave', { visitId: hosted.visitId });
});

test('guest resumes only with its JWT and rotating token; stale commands and token replay cannot mutate the world', async () => {
  const { hs, hosted, join, host } = await openRoom();
  const guest = await register('recovering guest');
  const gs = await connect(guest);
  const entered = await ack(gs, 'visit:join', join);
  const service = await sessions();
  const state = service.find(gs.id);
  expect(
    (
      await ack(gs, 'player:chat', {
        visitId: entered.visitId,
        seq: 4,
        current: 'temporary',
        previous: '',
      })
    ).ok,
  ).toBe(true);
  const oldSocketId = gs.id;
  service.engine.input(state.room, state.member, {
    visitId: entered.visitId,
    seq: 5,
    movement: { x: 1, y: 0 },
  });
  service.engine.action(state.room, state.member, {
    visitId: entered.visitId,
    actionId: randomUUID(),
    action: 'stone',
  });
  service.disconnect(oldSocketId);
  gs.disconnect();
  await until(hs, 'world:snapshot', () => state.member.socketId === '');
  expect(() => service.find(oldSocketId)).toThrow('SESSION_ENDED');
  expect(state.member.movement).toEqual({ x: 0, y: 0 });
  expect(state.member.action).toBeUndefined();
  expect(state.room.chats.has(guest.deviceId)).toBe(false);
  const credentials = {
    version: 2,
    visitId: entered.visitId,
    resumeToken: entered.resumeToken,
  };
  expect((await ack(hs, 'visit:resume', credentials)).code).toBe(
    'SESSION_ENDED',
  );
  const restoredSocket = await connect(guest);
  expect(
    (
      await ack(restoredSocket, 'visit:resume', {
        ...credentials,
        resumeToken: 'z'.repeat(43),
      })
    ).code,
  ).toBe('SESSION_ENDED');
  const restored = await ack(restoredSocket, 'visit:resume', credentials);
  expect(restored.ok).toBe(true);
  expect(restored.worldId).toBe(entered.worldId);
  expect(restored.playerId).toBe(guest.deviceId);
  expect(restored.visitId).not.toBe(entered.visitId);
  expect(restored.resumeToken).not.toBe(entered.resumeToken);
  expect(restored.snapshot.world.tick).toBeGreaterThanOrEqual(
    entered.snapshot.world.tick,
  );
  expect(restored.snapshot.lastProcessedSeq[guest.deviceId]).toBe(0);
  expect((await ack(restoredSocket, 'visit:resume', credentials)).code).toBe(
    'SESSION_ENDED',
  );
  expect(
    (
      await ack(restoredSocket, 'player:input', {
        visitId: entered.visitId,
        seq: 999,
        movement: { x: 1, y: 0 },
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(
    (
      await ack(restoredSocket, 'player:action', {
        visitId: entered.visitId,
        actionId: randomUUID(),
        action: 'stone',
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(
    (
      await ack(restoredSocket, 'player:input', {
        visitId: restored.visitId,
        seq: 1,
        movement: { x: 0, y: 0 },
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await ack(restoredSocket, 'player:chat', {
        visitId: restored.visitId,
        seq: 1,
        current: 'resumed draft',
        previous: '',
      })
    ).ok,
  ).toBe(true);
  expect(state.member.chatSeq).toBe(1);
  const kicked = until(restoredSocket, 'room:closed', () => true);
  await ack(hs, 'visit:kick', {
    visitId: hosted.visitId,
    commandId: randomUUID(),
    targetPlayerId: guest.deviceId,
  });
  await kicked;
  expect(
    (
      await ack(restoredSocket, 'visit:resume', {
        version: 2,
        visitId: restored.visitId,
        resumeToken: restored.resumeToken,
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(host.deviceId).toBe(hosted.playerId);
  await ack(hs, 'visit:leave', { visitId: hosted.visitId });
});

test('host transport loss preserves the world, expiry closes it, and expired guest credentials cannot resume', async () => {
  const { host, hs, hosted, join } = await openRoom();
  const guest = await register('waiting guest');
  const gs = await connect(guest);
  const entered = await ack(gs, 'visit:join', join);
  const service = await sessions();
  const state = service.find(hs.id);
  const closures = [];
  gs.on('room:closed', (body) => closures.push(body));
  hs.disconnect();
  await until(gs, 'world:snapshot', () => state.member.socketId === '');
  expect(closures).toHaveLength(0);
  const reconnected = await connect(host);
  const restored = await ack(reconnected, 'visit:resume', {
    version: 2,
    visitId: hosted.visitId,
    resumeToken: hosted.resumeToken,
  });
  expect(restored.ok).toBe(true);
  expect(restored.worldId).toBe(hosted.worldId);
  expect(restored.snapshot.members).toHaveLength(2);
  const guestState = service.find(gs.id);
  gs.disconnect();
  await until(
    reconnected,
    'world:snapshot',
    () => guestState.member.socketId === '',
  );
  guestState.member.disconnectExpiresAt = Date.now() - 1;
  const gs2 = await connect(guest);
  expect(
    (
      await ack(gs2, 'visit:resume', {
        version: 2,
        visitId: entered.visitId,
        resumeToken: entered.resumeToken,
      })
    ).code,
  ).toBe('SESSION_ENDED');
  service.expireDisconnected();
  expect(state.room.members.size).toBe(1);
  expect((await ack(gs2, 'visit:join', join)).ok).toBe(true);
  const closed = until(
    gs2,
    'room:closed',
    (body) => body.code === 'HOST_OFFLINE',
  );
  service.disconnect(reconnected.id);
  reconnected.disconnect();
  state.member.disconnectExpiresAt = Date.now() - 1;
  await closed;
  expect(service.engine.rooms.has(hosted.roomId)).toBe(false);
});

test('profiles update host and guest nicknames, persist across rooms and keep legacy snapshots compatible', async () => {
  const { host, hs, hosted, join } = await openRoom();
  const guest = await register('profile guest');
  const gs = await connect(guest);
  const entered = await ack(gs, 'visit:join', join);
  expect(entered.ok).toBe(true);
  const profiles = until(hs, 'room:profiles', (body) =>
    body.profiles.some(
      (profile) =>
        profile.playerId === guest.deviceId && profile.skin === 'mochi',
    ),
  );
  const renamed = until(hs, 'world:snapshot', (body) =>
    body.members.some(
      (member) =>
        member.playerId === guest.deviceId && member.nickname === '새 방문자',
    ),
  );
  expect(
    await ack(gs, 'player:profile', {
      visitId: entered.visitId,
      nickname: ' 새 방문자 ',
      skin: 'mochi',
    }),
  ).toEqual({ ok: true });
  expect((await profiles).worldId).toBe(hosted.worldId);
  const snapshot = await renamed;
  expect(
    snapshot.members.every(
      (member) =>
        Object.keys(member).sort().join(',') === 'nickname,playerId,role',
    ),
  ).toBe(true);
  expect(
    await ack(hs, 'player:profile', {
      visitId: hosted.visitId,
      nickname: '새 호스트',
      skin: 'mint',
    }),
  ).toEqual({ ok: true });
  expect(
    (
      await ack(gs, 'player:profile', {
        visitId: hosted.visitId,
        nickname: '위조',
      })
    ).code,
  ).toBe('SESSION_ENDED');
  expect(
    (
      await ack(gs, 'player:profile', {
        visitId: entered.visitId,
        nickname: ' ',
      })
    ).code,
  ).toBe('INVALID_INPUT');
  expect(
    (
      await ack(gs, 'player:profile', {
        visitId: entered.visitId,
        skin: 'unknown',
      })
    ).code,
  ).toBe('INVALID_INPUT');
  expect((await ack(gs, 'visit:leave', { visitId: entered.visitId })).ok).toBe(
    true,
  );
  const own = await ack(gs, 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
  expect(own.snapshot.members[0].nickname).toBe('새 방문자');
  expect((await ack(hs, 'visit:leave', { visitId: hosted.visitId })).ok).toBe(
    true,
  );
  expect((await ack(gs, 'visit:leave', { visitId: own.visitId })).ok).toBe(
    true,
  );
  hs.disconnect();
  gs.disconnect();
  const { Database } = await import('../dist/app.mjs');
  expect(
    (
      await app
        .get(Database)
        .deviceIdentity.findUniqueOrThrow({ where: { id: host.deviceId } })
    ).nickname,
  ).toBe('새 호스트');
});
