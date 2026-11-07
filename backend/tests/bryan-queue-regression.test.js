const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createQueueEntryService } = require('../src/modules/bryan/queueEntryService');

const person = (name, role = 'user') => ({ id: randomUUID(), name, email: `${name.toLowerCase()}@example.com`, role });
const users = { admin: person('Admin', 'admin'), ana: person('Ana'), ben: person('Ben'), cy: person('Cy'), dee: person('Dee') };

let dir;
let file;
let db;
let store;
let app;

function boot() {
  db = openDatabase({ filename: file });
  runMigrations(db);
  Object.values(users).forEach(user => db.prepare(`INSERT OR IGNORE INTO user_credentials (id, email, password_hash, role)
    VALUES (?, ?, 'test-hash', ?)`).run(user.id, user.email, user.role === 'admin' ? 'Administrator' : 'User'));
  store = createStore();
  app = createApp({ store, db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
}

function restart() {
  app.locals.stopSubscribers();
  db.close();
  boot();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-bryan-regression-'));
  file = path.join(dir, 'test.sqlite');
  boot();
});

afterEach(() => {
  app.locals.stopSubscribers();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);
const nextMillisecond = async () => {
  const start = Date.now();
  while (Date.now() === start) await new Promise(resolve => setImmediate(resolve));
};
const join = async (who, serviceId) => {
  const res = await as(who, 'post', `/api/services/${serviceId}/queue/join`).send({});
  await nextMillisecond();
  return res;
};
const adminQueue = async serviceId => (await as('admin', 'get', `/api/admin/services/${serviceId}/queue`)).body.data
  .map(s => [s.entry.userId, s.position, s.estimatedWaitMinutes]);
const status = async (who, serviceId) => (await as(who, 'get', `/api/services/${serviceId}/queue/me`)).body.data;

function expectQueuesConsistent() {
  const rows = db.prepare('SELECT * FROM queue_entry').all();
  const waitingByQueue = new Map();
  for (const row of rows) {
    if (row.status === 'waiting') {
      expect(row.finished_at).toBeNull();
      waitingByQueue.set(row.queue_id, [...(waitingByQueue.get(row.queue_id) ?? []), row]);
    } else {
      expect(row.position).toBe(0);
      expect(row.finished_at >= row.joined_at).toBe(true);
    }
  }
  for (const waiting of waitingByQueue.values()) {
    const byPosition = [...waiting].sort((a, b) => a.position - b.position);
    const byRule = [...waiting].sort((a, b) => b.priority_level - a.priority_level
      || a.joined_at.localeCompare(b.joined_at) || a.id.localeCompare(b.id));
    expect(byPosition.map(row => row.position)).toEqual(waiting.map((_, i) => i + 1));
    expect(byPosition.map(row => row.id)).toEqual(byRule.map(row => row.id));
  }
  const mirrored = [...store.queueEntries.values()].filter(entry => entry.status === 'waiting').map(entry => entry.id);
  expect(mirrored.sort()).toEqual(rows.filter(row => row.status === 'waiting').map(row => row.id).sort());
}

describe('queue lifecycle across backend restarts', () => {
  test('positions, waits, history, statistics, and notifications stay consistent', async () => {
    const advising = (await as('admin', 'post', '/api/services').send({ name: 'Student Advising',
      description: 'Course planning help', expectedDurationMinutes: 15, priority: 'medium' })).body.data;
    const support = (await as('admin', 'post', '/api/services').send({ name: 'Technical Support',
      description: 'Laptop help', expectedDurationMinutes: 10, priority: 'high' })).body.data;
    for (const service of [advising, support]) {
      await as('admin', 'patch', `/api/admin/services/${service.id}/queue`).send({ isOpen: true });
    }

    const ana = (await join('ana', advising.id)).body.data.entry;
    const ben = (await join('ben', advising.id)).body.data.entry;
    const cy = (await join('cy', advising.id)).body.data.entry;
    await join('ana', support.id);
    const dee = (await join('dee', support.id)).body.data.entry;
    await as('admin', 'patch', `/api/admin/services/${advising.id}/queue/${cy.id}`).send({ priority: 'high' });
    expectQueuesConsistent();

    restart();
    expectQueuesConsistent();
    expect(await adminQueue(advising.id)).toEqual([
      [users.cy.id, 1, 0], [users.ana.id, 2, 15], [users.ben.id, 3, 30]]);
    expect(await adminQueue(support.id)).toEqual([[users.ana.id, 1, 0], [users.dee.id, 2, 10]]);
    expect(await status('ben', advising.id)).toMatchObject({ position: 3, estimatedWaitMinutes: 30 });
    const dashboard = (await as('ana', 'get', '/api/me/dashboard')).body.data.queues;
    expect(dashboard.map(q => [q.entry.serviceId, q.position]).sort())
      .toEqual([[advising.id, 2], [support.id, 1]].sort());

    expect((await as('admin', 'post', `/api/admin/services/${advising.id}/queue/serve-next`)).body.data.entry.id).toBe(cy.id);
    expect((await as('ben', 'delete', `/api/services/${advising.id}/queue/me`)).status).toBe(200);
    expect((await as('admin', 'delete', `/api/admin/services/${support.id}/queue/${dee.id}`)).status).toBe(200);
    await as('admin', 'patch', `/api/admin/services/${advising.id}/queue`).send({ isOpen: false });
    expectQueuesConsistent();

    restart();
    expectQueuesConsistent();
    expect(await adminQueue(advising.id)).toEqual([[users.ana.id, 1, 0]]);
    expect(await adminQueue(support.id)).toEqual([[users.ana.id, 1, 0]]);
    expect((await join('dee', advising.id)).body.error.code).toBe('QUEUE_CLOSED');
    expect((await as('admin', 'post', `/api/admin/services/${advising.id}/queue/serve-next`)).body.data.entry.id)
      .toBe(ana.id);
    expect((await as('admin', 'post', `/api/admin/services/${advising.id}/queue/serve-next`)).body.error.code)
      .toBe('QUEUE_EMPTY');
    expectQueuesConsistent();

    restart();
    const history = who => as(who, 'get', '/api/me/queue-history').then(res => res.body.data.items
      .map(item => [item.entryId, item.serviceName, item.outcome]));
    expect(await history('ana')).toEqual([[ana.id, 'Student Advising', 'served']]);
    expect(await history('ben')).toEqual([[ben.id, 'Student Advising', 'canceled']]);
    expect(await history('cy')).toEqual([[cy.id, 'Student Advising', 'served']]);
    expect(await history('dee')).toEqual([[dee.id, 'Technical Support', 'canceled']]);

    const svc = createQueueEntryService({ db, store, events: app.locals.events });
    const stats = svc.getEntryStats();
    expect(stats).toEqual({ waitingCount: 1, servedCount: 2, canceledCount: 2 });
    const all = (await as('admin', 'get', '/api/admin/queue-history')).body.data;
    expect(all.total).toBe(stats.servedCount + stats.canceledCount);
    expect((await as('admin', 'get', '/api/admin/dashboard')).body.data.waitingCount).toBe(stats.waitingCount);

    const count = type => db.prepare('SELECT count(*) AS n FROM notification WHERE type = ?').get(type).n;
    expect(count('queue.joined')).toBe(5);
    expect(count('queue.served')).toBe(stats.servedCount);
  });
});

describe('real server process', () => {
  const backend = path.join(__dirname, '..');
  const admin = { email: 'admin@regression.test', password: 'AdminPass123!' };
  let port;
  let child;

  const freePort = () => new Promise(resolve => {
    const probe = net.createServer().listen(0, () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });

  function startServer() {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: backend,
      env: { ...process.env, PORT: String(port), QUEUESMART_DB_PATH: file, NODE_NO_WARNINGS: '1',
        DEMO_ADMIN_EMAIL: admin.email, DEMO_ADMIN_PASSWORD: admin.password },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => { if (String(chunk).includes('listening')) resolve(); });
      child.once('exit', code => reject(new Error(`server exited early with code ${code}`)));
    });
  }

  function stopServer(signal) {
    return new Promise(resolve => {
      child.removeAllListeners('exit');
      child.once('exit', resolve);
      child.kill(signal);
    });
  }

  async function call(method, url, token, body) {
    const res = await fetch(`http://127.0.0.1:${port}/api${url}`, { method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const login = async (email, password) => (await call('POST', '/auth/login', null, { email, password })).body.data.token;

  beforeEach(async () => {
    app.locals.stopSubscribers();
    db.close();
    port = await freePort();
  });

  afterEach(async () => {
    if (child && child.exitCode === null && child.signalCode === null) await stopServer('SIGTERM');
  });

  test('queue state survives a clean restart and a hard crash with real logins', async () => {
    await startServer();
    let adminToken = await login(admin.email, admin.password);
    for (const name of ['Ana', 'Ben']) {
      const res = await call('POST', '/auth/register', null,
        { name, email: `${name.toLowerCase()}@regression.test`, password: 'UserPass123!' });
      expect(res.status).toBe(201);
    }
    let anaToken = await login('ana@regression.test', 'UserPass123!');
    let benToken = await login('ben@regression.test', 'UserPass123!');
    const service = (await call('POST', '/services', adminToken, { name: 'Student Advising',
      description: 'Course planning help', expectedDurationMinutes: 15, priority: 'medium' })).body.data;
    await call('PATCH', `/admin/services/${service.id}/queue`, adminToken, { isOpen: true });
    expect((await call('POST', `/services/${service.id}/queue/join`, anaToken, {})).body.data.position).toBe(1);
    expect((await call('POST', `/services/${service.id}/queue/join`, benToken, {})).body.data.position).toBe(2);

    await stopServer('SIGTERM');
    await startServer();
    expect((await call('GET', `/services/${service.id}/queue/me`, benToken)).status).toBe(401);
    adminToken = await login(admin.email, admin.password);
    anaToken = await login('ana@regression.test', 'UserPass123!');
    benToken = await login('ben@regression.test', 'UserPass123!');
    expect((await call('GET', `/services/${service.id}/queue/me`, benToken)).body.data)
      .toMatchObject({ position: 2, estimatedWaitMinutes: 15 });
    expect((await call('POST', `/admin/services/${service.id}/queue/serve-next`, adminToken)).body.data.entry.status)
      .toBe('served');

    await stopServer('SIGKILL');
    await startServer();
    adminToken = await login(admin.email, admin.password);
    anaToken = await login('ana@regression.test', 'UserPass123!');
    benToken = await login('ben@regression.test', 'UserPass123!');
    expect((await call('GET', `/services/${service.id}/queue/me`, benToken)).body.data)
      .toMatchObject({ position: 1, estimatedWaitMinutes: 0 });
    expect((await call('GET', `/admin/services/${service.id}/queue`, adminToken)).body.data).toHaveLength(1);
    const history = (await call('GET', '/me/queue-history', anaToken)).body.data.items;
    expect(history.map(item => [item.serviceName, item.outcome])).toEqual([['Student Advising', 'served']]);
    expect((await call('GET', '/me/queue-history', benToken)).body.data.items).toEqual([]);
  }, 30000);
});