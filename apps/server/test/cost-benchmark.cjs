// Stage 0: run against an isolated, migrated local PostgreSQL database.
// Instrumentation lives in this harness; production timing and contracts stay intact.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { fork, execFile } = require('node:child_process');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const { writeFile, mkdir } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { setInterval, clearInterval } = require('node:timers');
const { promisify } = require('node:util');
const request = require('supertest');
const { io } = require('socket.io-client');

const database = new URL(process.env.TEST_DATABASE_URL ?? 'http://missing');
assert.equal(database.protocol, 'postgresql:', 'Set TEST_DATABASE_URL');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.match(database.pathname, /test/i, 'Use an isolated test database');
function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isInteger(value) && value >= min && value <= max, name);
  return value;
}
const settings = {
  rooms: (process.env.COST_BENCH_ROOMS ?? '1,2,3').split(',').map(Number),
  participants: integer('COST_BENCH_PARTICIPANTS', 6, 2, 6),
  repeats: integer('COST_BENCH_REPEATS', 3, 1, 20),
  warmupMs: integer('COST_BENCH_WARMUP_MS', 5000, 1000, 600000),
  phaseMs: integer('COST_BENCH_PHASE_MS', 30000, 1000, 3600000),
  longMs: integer('COST_BENCH_LONG_MS', 600000, 1000, 86400000),
  churnCycles: integer('COST_BENCH_CHURN_CYCLES', 5, 1, 100),
  // Optional handshake capability; servers that do not know it ignore it.
  idleSnapshots: process.env.COST_BENCH_IDLE_SNAPSHOTS === '1',
};
// Identifies the product code under test; excludes this harness and tests.
function sourceHash() {
  const hash = createHash('sha256');
  for (const root of [
    'apps/server/src',
    'packages/protocol/src',
    'packages/game-core/src',
  ]) {
    const base = join(
      dirname(require.resolve('../package.json')),
      '../..',
      root,
    );
    const files = readdirSync(base, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();
    for (const file of files) {
      hash.update(`${root}/${file}\0`);
      hash.update(readFileSync(join(base, file)));
    }
  }
  return hash.digest('hex');
}
assert.ok(settings.rooms.length > 0);
assert.ok(
  settings.rooms.every((n) => Number.isInteger(n) && n >= 1 && n <= 100),
);
assert.ok(settings.rooms.every((n, i, a) => i === 0 || n > a[i - 1]));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return {
    count: sorted.length,
    mean: sorted.length
      ? sorted.reduce((a, b) => a + b, 0) / sorted.length
      : null,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? null,
  };
}

async function worker() {
  const { createApp, Database, SimulationEngine } =
    await import('../dist/app.mjs');
  const app = await createApp({
    DATABASE_URL: database.href,
    JWT_SECRET: randomBytes(32).toString('hex'),
    PORT: 3003,
    PUBLIC_ORIGIN: 'http://127.0.0.1:3003',
    CLIENT_ORIGINS: 'http://127.0.0.1:1420',
    origins: ['http://127.0.0.1:1420'],
    ACCESS_TTL_SECONDS: 86400,
    INVITE_TTL_SECONDS: 86400,
  });
  const db = app.get(Database);
  const engine = app.get(SimulationEngine);
  const http = app.getHttpServer();
  const sockets = new Set();
  let closedBytes = 0;
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      closedBytes += socket.bytesWritten;
      sockets.delete(socket);
    });
  });
  let authLookups = 0;
  const find = db.deviceIdentity.findUnique.bind(db.deviceIdentity);
  db.deviceIdentity.findUnique = (args) => {
    if (args.select?.revokedAt === true) {
      authLookups++;
    }
    return find(args);
  };
  const findMany = db.deviceIdentity.findMany.bind(db.deviceIdentity);
  db.deviceIdentity.findMany = (args) => {
    if (args?.select?.revokedAt === true) {
      authLookups++;
    }
    return findMany(args);
  };
  let tickSamples = [],
    schedulerSamples = [],
    schedulerLate = [],
    roomSteps = 0;
  let lastScheduler;
  const step = engine.step.bind(engine);
  engine.step = (room) => {
    const start = performance.now();
    const value = step(room);
    tickSamples.push(performance.now() - start);
    roomSteps++;
    return value;
  };
  const advance = engine.advanceTime.bind(engine);
  engine.advanceTime = (now) => {
    const start = performance.now();
    if (lastScheduler !== undefined) {
      schedulerLate.push(Math.max(0, now - lastScheduler - 25));
    }
    lastScheduler = now;
    advance(now);
    schedulerSamples.push(performance.now() - start);
  };
  let peakRss = process.memoryUsage().rss;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 100);
  function metrics(reset) {
    const result = {
      wallMs: performance.now(),
      cpu: process.cpuUsage(),
      memory: process.memoryUsage(),
      peakRss,
      authLookups,
      tcpBytesWritten:
        closedBytes + [...sockets].reduce((n, s) => n + s.bytesWritten, 0),
      rooms: engine.rooms.size,
      members: [...engine.rooms.values()].reduce(
        (n, r) => n + r.members.size,
        0,
      ),
      httpConnections: sockets.size,
      roomSteps,
      roomStepMs: summary(tickSamples),
      schedulerExecutionMs: summary(schedulerSamples),
      schedulerLateMs: summary(schedulerLate),
      schedulerGapsOver250Ms: schedulerLate.filter((n) => n > 225).length,
    };
    if (reset) {
      tickSamples = [];
      schedulerSamples = [];
      schedulerLate = [];
      roomSteps = 0;
      peakRss = process.memoryUsage().rss;
      lastScheduler = undefined;
    }
    return result;
  }
  await app.listen(0, '127.0.0.1');
  process.send({ type: 'ready', base: await app.getUrl() });
  process.on('message', (message) => {
    if (message.type === 'metrics') {
      process.send({
        type: 'metrics',
        id: message.id,
        ...metrics(message.reset),
      });
    }
    if (message.type === 'stop') {
      void (async () => {
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
          assert.equal(
            await db.deviceIdentity.count({
              where: { id: { in: message.deviceIds } },
            }),
            0,
          );
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

function message(child, type, id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error(`Worker ${type} timeout`)),
      20000,
    );
    function finish(error, value) {
      clearTimeout(timeout);
      child.off('message', receive);
      child.off('exit', exited);
      child.off('error', finish);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }
    function receive(value) {
      if (value.type === type && (id === undefined || value.id === id)) {
        finish(null, value);
      }
    }
    function exited(code) {
      finish(new Error(`Worker exited (${code}) before ${type}`));
    }
    child.on('message', receive);
    child.once('exit', exited);
    child.once('error', finish);
  });
}
async function metrics(child, reset = false) {
  const id = randomUUID();
  const result = message(child, 'metrics', id);
  child.send({ type: 'metrics', id, reset });
  return result;
}
async function stopWorker(child, deviceIds) {
  const stopped = message(child, 'stopped');
  let timeout;
  const exited = new Promise((resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error('Worker shutdown timeout')),
      20000,
    );
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Worker shutdown failed (${code})`));
      }
    });
  });
  child.send({ type: 'stop', deviceIds });
  try {
    await Promise.all([stopped, exited]);
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function dbMetrics() {
  const container = process.env.COST_BENCH_DB_CONTAINER;
  if (!container) {
    return null;
  }
  const { stdout } = await promisify(execFile)(
    'docker',
    [
      'exec',
      container,
      'cat',
      '/sys/fs/cgroup/cpu.stat',
      '/sys/fs/cgroup/memory.current',
    ],
    { timeout: 10000, windowsHide: true },
  );
  const lines = stdout.trim().split(/\r?\n/);
  return {
    wallMs: performance.now(),
    cpuMicroseconds: Number(stdout.match(/usage_usec (\d+)/)[1]),
    memoryBytes: Number(lines.at(-1)),
  };
}
async function connect(base, peer) {
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
    timeout: 5000,
    auth: {
      version: 2,
      token: peer.user.accessToken,
      health: true,
      ...(settings.idleSnapshots ? { idleSnapshots: true } : {}),
    },
  });
  peer.socket = socket;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('Connect timeout')), 6000);
    function done(error) {
      clearTimeout(timer);
      socket.off('connect', connected);
      socket.off('connect_error', done);
      if (error) {
        socket.disconnect();
        reject(error);
      } else {
        resolve();
      }
    }
    function connected() {
      done();
    }
    socket.once('connect', connected);
    socket.once('connect_error', done);
    socket.connect();
  });
}
async function ack(peer, event, body) {
  const result = await peer.socket.timeout(5000).emitWithAck(event, body);
  assert.equal(result.ok, true, `${event}: ${result.code}`);
  return result;
}
async function openRoom(room) {
  room[0].joined = await ack(room[0], 'room:host', {
    version: 2,
    bounds: { width: 1280, height: 720 },
  });
}
async function joinGuests(api, room) {
  const invite = await api
    .post('/v1/rooms/me/invites')
    .set('Authorization', `Bearer ${room[0].user.accessToken}`);
  assert.equal(invite.status, 201);
  const token = new URL(invite.body.link).pathname.slice(6);
  for (const peer of room.slice(1)) {
    peer.joined = await ack(peer, 'visit:join', { version: 2, token });
  }
}
function cpuPercent(before, after, elapsedMs) {
  return (
    (after.user + after.system - before.user - before.system) / elapsedMs / 10
  );
}
async function phase(child, peers, label, active, durationMs) {
  const pending = new Set();
  const acks = [],
    failures = {},
    snapshotSizes = [],
    intervals = [];
  let jsonBytes = 0,
    snapshots = 0,
    sent = 0,
    observedProjectiles = 0,
    observedEffects = 0;
  let previousAt;
  const dbBefore = await dbMetrics();
  const listeners = peers.map((peer, index) => {
    const receive = (snapshot) => {
      const bytes = Buffer.byteLength(JSON.stringify(snapshot));
      jsonBytes += bytes;
      snapshots++;
      if (index === 0) {
        snapshotSizes.push(bytes);
        const now = performance.now();
        if (previousAt !== undefined) {
          intervals.push(now - previousAt);
        }
        previousAt = now;
        observedProjectiles += snapshot.world.projectiles.length;
        observedEffects += snapshot.world.effects.length;
      }
    };
    peer.socket.on('world:snapshot', receive);
    return receive;
  });
  const before = await metrics(child, true);
  const clientCpu = process.cpuUsage();
  let clientPeakRss = process.memoryUsage().rss;
  let iteration = 0;
  const sample = setInterval(() => {
    clientPeakRss = Math.max(clientPeakRss, process.memoryUsage().rss);
  }, 100);
  function send(peer, event, body) {
    sent++;
    const start = performance.now();
    const operation = ack(peer, event, body)
      .then(() => {
        if (event === 'player:input') {
          acks.push(performance.now() - start);
        }
      })
      .catch((error) => {
        const reason = error.message;
        failures[reason] = (failures[reason] ?? 0) + 1;
      })
      .finally(() => pending.delete(operation));
    pending.add(operation);
  }
  const inputTimer = active
    ? setInterval(() => {
        iteration++;
        for (const [index, peer] of peers.entries()) {
          send(peer, 'player:input', {
            visitId: peer.joined.visitId,
            seq: ++peer.seq,
            movement: {
              x: Math.floor(iteration / 10) % 2 ? -1 : 1,
              y: index % 2 ? 0 : 1,
            },
          });
          if (iteration % 10 === 0) {
            send(peer, 'player:action', {
              visitId: peer.joined.visitId,
              actionId: randomUUID(),
              action: iteration % 20 === 0 ? 'stone' : 'melee',
            });
            send(peer, 'player:chat', {
              visitId: peer.joined.visitId,
              seq: ++peer.chatSeq,
              current: 'baseline chat 0123456789',
              previous: 'previous baseline message',
            });
          }
        }
      }, 100)
    : undefined;
  let after;
  try {
    await sleep(durationMs);
    if (inputTimer !== undefined) {
      clearInterval(inputTimer);
    }
    await Promise.all(pending);
    after = await metrics(child);
  } finally {
    if (inputTimer !== undefined) {
      clearInterval(inputTimer);
    }
    clearInterval(sample);
    peers.forEach((p, i) => p.socket.off('world:snapshot', listeners[i]));
  }
  const clientAfter = process.cpuUsage();
  const dbAfter = await dbMetrics();
  const elapsedMs = after.wallMs - before.wallMs;
  const result = {
    label,
    durationMs,
    elapsedMs,
    peers: peers.length,
    server: {
      cpuPercentOfOneCore: cpuPercent(before.cpu, after.cpu, elapsedMs),
      rssMiB: after.memory.rss / 1048576,
      peakRssMiB: after.peakRss / 1048576,
      heapUsedMiB: after.memory.heapUsed / 1048576,
      authLookupCalls: after.authLookups - before.authLookups,
      tcpBytesWritten: after.tcpBytesWritten - before.tcpBytesWritten,
      tcpBytesPerSecond:
        ((after.tcpBytesWritten - before.tcpBytesWritten) * 1000) / elapsedMs,
      roomSteps: after.roomSteps,
      roomStepMs: after.roomStepMs,
      schedulerExecutionMs: after.schedulerExecutionMs,
      schedulerLateMs: after.schedulerLateMs,
      schedulerGapsOver250Ms: after.schedulerGapsOver250Ms,
      rooms: after.rooms,
      members: after.members,
      httpConnections: after.httpConnections,
    },
    client: {
      cpuPercentOfOneCore: cpuPercent(clientCpu, clientAfter, elapsedMs),
      peakRssMiB: clientPeakRss / 1048576,
    },
    database: dbAfter
      ? {
          before: dbBefore,
          after: dbAfter,
          cpuPercentOfOneCore:
            (dbAfter.cpuMicroseconds - dbBefore.cpuMicroseconds) /
            (dbAfter.wallMs - dbBefore.wallMs) /
            10,
          memoryMiB: dbAfter.memoryBytes / 1048576,
        }
      : null,
    sentCommands: sent,
    failedCommands: failures,
    inputAckRttMs: summary(acks),
    snapshots,
    snapshotJsonBytes: jsonBytes,
    snapshotJsonBytesPerSecond: (jsonBytes * 1000) / elapsedMs,
    hostSnapshotBytes: summary(snapshotSizes),
    hostSnapshotIntervalMs: summary(intervals),
    observedProjectiles,
    observedEffects,
  };
  process.stderr.write(
    `${label}: ${peers.length} peers, ${result.server.tcpBytesPerSecond.toFixed(0)} bytes/s\n`,
  );
  return result;
}
async function reconnect(base, peer) {
  const old = peer.joined;
  peer.socket.disconnect();
  // Exercise an actual transport outage, within the current 10-second grace window.
  await sleep(250);
  await connect(base, peer);
  const start = performance.now();
  const joined = await ack(peer, 'visit:resume', {
    version: 2,
    visitId: old.visitId,
    resumeToken: old.resumeToken,
  });
  assert.equal(joined.worldId, old.worldId);
  assert.equal(joined.playerId, old.playerId);
  assert.notEqual(joined.visitId, old.visitId);
  assert.notEqual(joined.resumeToken, old.resumeToken);
  const stale = await peer.socket.timeout(5000).emitWithAck('player:input', {
    visitId: old.visitId,
    seq: 999999,
    movement: { x: 1, y: 0 },
  });
  assert.equal(stale.code, 'SESSION_ENDED');
  peer.joined = joined;
  peer.seq = 0;
  peer.chatSeq = 0;
  return {
    role: joined.role,
    resumeAndStaleCheckMs: performance.now() - start,
    sameWorld: true,
    tokenRotated: true,
    staleVisitRejected: true,
    members: joined.snapshot.members.length,
  };
}
async function runCase(roomCount, report, save) {
  const child = fork(process.argv[1], ['--worker'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const peers = [],
    deviceIds = [],
    rooms = [];
  const result = { roomCount, phases: [], recovery: [], churn: [] };
  report.cases.push(result);
  try {
    const { base } = await message(child, 'ready');
    const api = request(base);
    async function measure(label, selected, active, ms = settings.phaseMs) {
      result.phases.push(
        await phase(
          child,
          selected,
          `${roomCount} rooms / ${label}`,
          active,
          ms,
        ),
      );
      await save();
    }
    async function repeated(label, selected, active) {
      // Warm-up input and chat are identical to the measured condition.
      await phase(
        child,
        selected,
        'warmup (excluded)',
        active,
        settings.warmupMs,
      );
      for (let n = 1; n <= settings.repeats; n++) {
        await measure(`${label} #${n}`, selected, active);
      }
    }
    await repeated('empty', [], false);
    let registered = 0,
      registrationWindow = performance.now();
    async function addPeer() {
      if (registered > 0 && registered % 10 === 0) {
        const waitMs = Math.max(
          0,
          61000 - (performance.now() - registrationWindow),
        );
        process.stderr.write(
          `Respecting registration rate limit: waiting ${waitMs.toFixed(0)}ms\n`,
        );
        await sleep(waitMs);
        registrationWindow = performance.now();
      }
      const response = await api
        .post('/v1/devices')
        .send({ nickname: `cost baseline ${registered}` });
      assert.equal(response.status, 201);
      registered++;
      deviceIds.push(response.body.deviceId);
      const peer = { user: response.body, seq: 0, chatSeq: 0 };
      peers.push(peer);
      await connect(base, peer);
      return peer;
    }
    for (let i = 0; i < roomCount; i++) {
      const room = [await addPeer()];
      rooms.push(room);
      await openRoom(room);
    }
    await repeated('solo-idle', [...peers], false);
    for (const room of rooms) {
      for (let n = 1; n < settings.participants; n++) {
        room.push(await addPeer());
      }
      await joinGuests(api, room);
    }
    await repeated('full-idle', peers, false);
    await repeated('full-active', peers, true);
    // At most 18 connections in the default matrix; wait out handshake rate limits before recovery.
    await sleep(Math.max(0, 61000 - (performance.now() - registrationWindow)));
    result.recovery.push(await reconnect(base, rooms[0].at(-1)));
    result.recovery.push(await reconnect(base, rooms[0][0]));
    if (roomCount === settings.rooms.at(-1)) {
      await measure('long-active', peers, true, settings.longMs);
      for (let cycle = 1; cycle <= settings.churnCycles; cycle++) {
        for (const room of rooms) {
          await ack(room[0], 'visit:leave', {
            visitId: room[0].joined.visitId,
          });
          await openRoom(room);
          await joinGuests(api, room);
        }
        result.churn.push({ cycle, ...(await metrics(child)) });
      }
    }
    for (const room of rooms) {
      await ack(room[0], 'visit:leave', { visitId: room[0].joined.visitId });
    }
    for (const peer of peers) {
      peer.socket.disconnect();
    }
    // Includes disconnect grace expiry and the one-minute bounded rate-limit window.
    await measure('post-close', [], false, 65000);
    const final = result.phases.at(-1).server;
    assert.equal(final.rooms, 0);
    assert.equal(final.members, 0);
    assert.equal(final.httpConnections, 0);
    assert.ok(
      result.phases.every((p) => Object.keys(p.failedCommands).length === 0),
    );
  } finally {
    peers.forEach((p) => p.socket?.disconnect());
    if (child.connected) {
      await stopWorker(child, deviceIds);
      result.fixtureCleanup = true;
    }
    await save();
  }
}
async function main() {
  const report = {
    measuredAtUtc: new Date().toISOString(),
    completed: false,
    settings,
    sourceSha256: sourceHash(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memoryGiB: os.totalmem() / 1073741824,
      release: os.release(),
    },
    measurement: {
      topology:
        'Windows server worker + separate Node load-generator process + isolated Docker PostgreSQL',
      transport:
        'loopback HTTP + WebSocket, health:true, idleSnapshots per settings, no TLS or reverse proxy',
      tcpBytes:
        'server HTTP net.Socket.bytesWritten including WebSocket/Engine.IO/Socket.IO framing; excludes IP/TCP headers, retransmissions, TLS and DB traffic; not provider-billed egress',
      jsonBytes:
        'sum of JSON.stringify(snapshot) UTF-8 bytes received by all peers',
      authLookups:
        'Prisma deviceIdentity.findUnique/findMany calls selecting revokedAt (one batched findMany counts once); logical auth lookup attempts, not PostgreSQL SQL statement count',
      tick: 'room step duration excludes gateway publish; scheduler execution includes step and synchronous publish; lateness = max(0, callback gap - 25ms)',
      database:
        'isolated container cgroup v2 CPU cumulative usage and memory including page cache; samples bracket each phase; not process RSS',
      ack: 'input emit to acceptance ack; not tick application, rendered response, or WAN latency',
      inputs:
        '10 inputs/s/player, direction flips every second; 1 alternating melee/stone and 1 chat/s/player; no injected loss',
      memory:
        'server and client RSS peak sampled every 100ms; no forced GC; retained RSS does not prove a leak',
    },
    cases: [],
  };
  const output = process.env.COST_BENCH_OUTPUT;
  assert.ok(output, 'Set COST_BENCH_OUTPUT to retain raw results');
  async function save() {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  try {
    for (const count of settings.rooms) {
      await runCase(count, report, save);
    }
    report.completed = true;
  } finally {
    await save();
  }
  process.stdout.write(`Saved ${output}\n`);
}
if (process.argv.includes('--worker')) {
  void worker().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
} else {
  void main().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
}
