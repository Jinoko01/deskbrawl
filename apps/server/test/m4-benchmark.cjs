const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { setInterval, clearInterval } = require('node:timers');
const { fork } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const request = require('supertest');
const { io } = require('socket.io-client');

const database = new URL(process.env.TEST_DATABASE_URL ?? 'http://missing');
assert.equal(database.protocol, 'postgresql:', 'Set TEST_DATABASE_URL');
assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname));
assert.match(database.pathname, /test/i, 'Use an isolated test database');
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const phaseMs = Number(process.env.M4_BENCH_PHASE_MS ?? 5000);
assert.ok(Number.isInteger(phaseMs) && phaseMs >= 1000 && phaseMs <= 30000);

async function worker() {
  const { createApp, Database } = await import('../dist/app.mjs');
  const app = await createApp({
    DATABASE_URL: database.href,
    JWT_SECRET: randomBytes(32).toString('hex'),
    PORT: 3003,
    PUBLIC_ORIGIN: 'http://127.0.0.1:3003',
    CLIENT_ORIGINS: 'http://127.0.0.1:1420',
    origins: ['http://127.0.0.1:1420'],
    ACCESS_TTL_SECONDS: 3600,
    INVITE_TTL_SECONDS: 3600,
  });
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 100);
  await app.listen(0, '127.0.0.1');
  process.send({ type: 'ready', base: await app.getUrl() });
  process.on('message', (message) => {
    if (message.type === 'metrics') {
      process.send({
        type: 'metrics',
        requestId: message.requestId,
        cpu: process.cpuUsage(),
        wallMs: performance.now(),
        rss: process.memoryUsage().rss,
        peakRss,
      });
    }
    if (message.type === 'stop') {
      void (async () => {
        const db = app.get(Database);
        try {
          await db.inviteToken.deleteMany({
            where: { room: { ownerDeviceId: { in: message.deviceIds } } },
          });
          await db.hostRoom.deleteMany({
            where: { ownerDeviceId: { in: message.deviceIds } },
          });
          await db.deviceIdentity.deleteMany({
            where: { id: { in: message.deviceIds } },
          });
        } finally {
          clearInterval(sample);
          await app.close();
          process.send({ type: 'stopped' });
          process.disconnect();
        }
      })().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        process.disconnect();
      });
    }
  });
}

function message(child, type, requestId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('message', receive);
      reject(new Error(`Worker ${type} timeout`));
    }, 15000);
    function receive(value) {
      if (
        value.type === type &&
        (requestId === undefined || value.requestId === requestId)
      ) {
        clearTimeout(timeout);
        child.off('message', receive);
        resolve(value);
      }
    }
    child.on('message', receive);
  });
}
async function metrics(child) {
  const requestId = randomUUID();
  const result = message(child, 'metrics', requestId);
  child.send({ type: 'metrics', requestId });
  return result;
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    null;
  return {
    count: values.length,
    mean: values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? null,
  };
}
async function connect(base, user) {
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
    auth: { version: 2, token: user.accessToken },
  });
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
async function phase(child, peers, label, delayed) {
  const before = await metrics(child);
  const intervals = [],
    sizes = [],
    ackRtts = [],
    intentLatencies = [];
  const pending = new Set();
  const seenTicks = new Map();
  let previousAt, previousTick;
  let attempted = 0,
    dropped = 0,
    failed = 0;
  const listeners = peers.map((peer, index) => {
    const listener = (snapshot) => {
      seenTicks.set(index, snapshot.world.tick);
      if (index === 0 && snapshot.world.tick !== previousTick) {
        const now = performance.now();
        if (previousAt !== undefined) {
          intervals.push(now - previousAt);
        }
        previousAt = now;
        previousTick = snapshot.world.tick;
        sizes.push(Buffer.byteLength(JSON.stringify(snapshot)));
      }
    };
    peer.socket.on('world:snapshot', listener);
    return listener;
  });
  const sendInputs = () => {
    for (const peer of peers) {
      attempted++;
      peer.seq++;
      if (delayed && attempted % 4 === 0) {
        dropped++;
        continue;
      }
      const intentAt = performance.now();
      const input = {
        visitId: peer.joined.visitId,
        seq: peer.seq,
        movement: { x: Math.floor(peer.seq / 5) % 2 ? -1 : 1, y: 0 },
      };
      const operation = (async () => {
        if (delayed) {
          await sleep(120);
        }
        const sentAt = performance.now();
        const result = await ack(peer.socket, 'player:input', input);
        assert.equal(result.ok, true);
        const now = performance.now();
        ackRtts.push(now - sentAt);
        intentLatencies.push(now - intentAt);
      })()
        .catch(() => {
          failed++;
        })
        .finally(() => pending.delete(operation));
      pending.add(operation);
    }
  };
  const interval = setInterval(sendInputs, 100);
  await sleep(phaseMs);
  clearInterval(interval);
  await Promise.all(pending);
  peers.forEach((peer, index) =>
    peer.socket.off('world:snapshot', listeners[index]),
  );
  const after = await metrics(child);
  const elapsedMs = after.wallMs - before.wallMs;
  return {
    label,
    nominalDurationMs: phaseMs,
    elapsedMs,
    peers: peers.length,
    attemptedInputs: attempted,
    applicationDroppedInputs: dropped,
    droppedFraction: dropped / attempted,
    failedAcks: failed,
    artificialDelayMs: delayed ? 120 : 0,
    ackRoundTripMs: summary(ackRtts),
    intentToAcceptedMs: summary(intentLatencies),
    hostSnapshotIntervalMs: summary(intervals),
    hostSnapshotBytes: summary(sizes),
    lastTickPerPeer: Object.fromEntries(seenTicks),
    serverCpuPercentOfOneCore:
      ((after.cpu.user +
        after.cpu.system -
        before.cpu.user -
        before.cpu.system) /
        1000 /
        elapsedMs) *
      100,
    serverRssMiB: after.rss / 1048576,
    serverPeakRssMiB: after.peakRss / 1048576,
  };
}
async function reconnect(base, peer, observer) {
  const old = peer.joined;
  const start = performance.now();
  const observedDisconnect = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.off('world:snapshot', receive);
      reject(new Error('Disconnect observation timeout'));
    }, 3000);
    function receive() {
      clearTimeout(timeout);
      observer.off('world:snapshot', receive);
      resolve();
    }
    observer.once('world:snapshot', receive);
  });
  peer.socket.disconnect();
  // Wait one authoritative broadcast, which follows transport disconnection on this local server.
  await observedDisconnect;
  await sleep(120);
  peer.socket = await connect(base, peer.user);
  const accepted = await ack(peer.socket, 'visit:resume', {
    version: 2,
    visitId: old.visitId,
    resumeToken: old.resumeToken,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.worldId, old.worldId);
  assert.equal(accepted.playerId, old.playerId);
  assert.notEqual(accepted.visitId, old.visitId);
  assert.notEqual(accepted.resumeToken, old.resumeToken);
  assert.equal(accepted.snapshot.members.length, 6);
  const stale = await ack(peer.socket, 'player:input', {
    visitId: old.visitId,
    seq: 999999,
    movement: { x: 1, y: 0 },
  });
  assert.equal(stale.code, 'SESSION_ENDED');
  peer.joined = accepted;
  peer.seq = 0;
  return {
    role: accepted.role,
    elapsedMs: performance.now() - start,
    injectedOfflineDelayMs: 120,
    sameWorld: true,
    membersAfterResume: accepted.snapshot.members.length,
    tokenRotated: true,
    staleVisitRejected: true,
  };
}
async function main() {
  const child = fork(process.argv[1], ['--worker'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const peers = [],
    deviceIds = [];
  try {
    const { base } = await message(child, 'ready');
    const api = request(base);
    for (let index = 0; index < 6; index++) {
      const registration = await api
        .post('/v1/devices')
        .send({ nickname: `M4 measurement ${index}` });
      assert.equal(registration.status, 201);
      deviceIds.push(registration.body.deviceId);
      const user = registration.body;
      const socket = await connect(base, user);
      peers.push({ socket, user, seq: 0 });
    }
    peers[0].joined = await ack(peers[0].socket, 'room:host', {
      version: 2,
      bounds: { width: 1280, height: 720 },
    });
    assert.equal(peers[0].joined.ok, true);
    const invitation = await api
      .post('/v1/rooms/me/invites')
      .set('Authorization', `Bearer ${peers[0].user.accessToken}`);
    const token = new URL(invitation.body.link).pathname.slice(6);
    for (const peer of peers.slice(1)) {
      peer.joined = await ack(peer.socket, 'visit:join', { version: 2, token });
      assert.equal(peer.joined.ok, true);
    }
    const phases = [];
    phases.push(await phase(child, peers, 'baseline', false));
    phases.push(
      await phase(
        child,
        peers,
        '120ms delayed, every fourth input omitted',
        true,
      ),
    );
    const recovery = [];
    recovery.push(await reconnect(base, peers[5], peers[0].socket));
    recovery.push(await reconnect(base, peers[0], peers[1].socket));
    const report = {
      measuredAtUtc: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      bounds: { width: 1280, height: 720 },
      rulesTickMs: 50,
      topology:
        'one local server worker process, six Node Socket.IO clients in a separate harness process; PostgreSQL isolated test database',
      impairment:
        'application input-intent scheduling only; no OS packet loss or physical Wi-Fi measurement',
      phases,
      recovery,
    };
    const output = process.env.M4_BENCH_OUTPUT;
    if (output) {
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    for (const peer of peers) {
      peer.socket.disconnect();
    }
    const stopped = message(child, 'stopped');
    child.send({ type: 'stop', deviceIds });
    await stopped;
  }
}
if (process.argv.includes('--worker')) {
  void worker().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
} else {
  void main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
