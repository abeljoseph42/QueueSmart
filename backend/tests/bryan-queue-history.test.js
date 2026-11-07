const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createQueueEntryService } = require('../src/modules/bryan/queueEntryService');
const { createQueueEntryRepository } = require('../src/modules/bryan/queueEntryRepository');

const person = (name, role = 'user') => ({ id: randomUUID(), name, email: `${name.toLowerCase()}@example.com`, role });
const users = { admin: person('Admin', 'admin'), ana: person('Ana'), ben: person('Ben') };
const advising = { name: 'Student Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priority: 'medium' };

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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-bryan-history-'));
  file = path.join(dir, 'test.sqlite');
  boot();
});

afterEach(() => {
  app.locals.stopSubscribers();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);
const createService = async (body = advising) => (await as('admin', 'post', '/api/services').send(body)).body.data;
const openService = async body => {
  const service = await createService(body);
  await as('admin', 'patch', `/api/admin/services/${service.id}/queue`).send({ isOpen: true });
  return service;
};
const queueIdOf = serviceId => db.prepare('SELECT id FROM queue WHERE service_id = ?').get(serviceId).id;
const myHistory = (who, query = '') => as(who, 'get', `/api/me/queue-history${query}`);
const allHistory = (query = '') => as('admin', 'get', `/api/admin/queue-history${query}`);

function clockFrom(start) {
  let ms = Date.parse(start);
  return () => new Date((ms += 60000));
}

async function visits() {
  const advisingDesk = await openService();
  const support = await openService({ ...advising, name: 'Technical Support', priority: 'high' });
  const svc = createQueueEntryService({ db, store, events: app.locals.events,
    now: clockFrom('2026-11-06T09:00:00.000Z') });
  const served = svc.joinQueue(users.ana, queueIdOf(advisingDesk.id));
  svc.serveNext(users.admin, queueIdOf(advisingDesk.id));
  const left = svc.joinQueue(users.ana, queueIdOf(support.id));
  svc.cancelEntry(users.ana, left.id);
  const removed = svc.joinQueue(users.ana, queueIdOf(advisingDesk.id));
  svc.cancelEntry(users.admin, removed.id);
  const bens = svc.joinQueue(users.ben, queueIdOf(advisingDesk.id));
  svc.serveNext(users.admin, queueIdOf(advisingDesk.id));
  const waiting = svc.joinQueue(users.ana, queueIdOf(support.id));
  return { advisingDesk, support, served, left, removed, bens, waiting };
}

describe('GET /api/me/queue-history', () => {
  test('starts empty with Heera-style paging fields', async () => {
    const res = await myHistory('ana');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });

  test('lists only the caller\'s finished visits, newest first, with service names and times', async () => {
    const { advisingDesk, support, served, left, removed } = await visits();
    const { data } = (await myHistory('ana')).body;
    expect(data).toMatchObject({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(data.items.map(item => [item.entryId, item.serviceName, item.outcome])).toEqual([
      [removed.id, 'Student Advising', 'canceled'],
      [left.id, 'Technical Support', 'canceled'],
      [served.id, 'Student Advising', 'served'],
    ]);
    expect(data.items[2]).toEqual({ id: served.id, entryId: served.id, userId: users.ana.id,
      serviceId: advisingDesk.id, serviceName: 'Student Advising', priority: 'medium',
      joinedAt: '2026-11-06T09:01:00.000Z', endedAt: '2026-11-06T09:02:00.000Z', outcome: 'served' });
    expect(data.items[1]).toMatchObject({ serviceId: support.id, priority: 'high' });
  });

  test('users never see another user\'s history, and waiting entries are not history', async () => {
    const { bens, waiting } = await visits();
    const ben = (await myHistory('ben')).body.data;
    expect(ben.items.map(item => item.entryId)).toEqual([bens.id]);
    const ana = (await myHistory('ana')).body.data.items.map(item => item.entryId);
    expect(ana).not.toContain(bens.id);
    expect(ana).not.toContain(waiting.id);
    expect((await myHistory('ana', `?userId=${users.ben.id}`)).status).toBe(400);
  });

  test('can be filtered by outcome', async () => {
    const { served, left, removed } = await visits();
    const servedOnly = (await myHistory('ana', '?outcome=served')).body.data;
    expect(servedOnly.items.map(item => item.entryId)).toEqual([served.id]);
    expect(servedOnly.total).toBe(1);
    const canceled = (await myHistory('ana', '?outcome=canceled')).body.data.items.map(item => item.entryId);
    expect(canceled).toEqual([removed.id, left.id]);
  });

  test('pages 20 by default, allows up to 100, and rejects bad paging values', async () => {
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const svc = createQueueEntryService({ db, store, events: app.locals.events,
      now: clockFrom('2026-11-06T09:00:00.000Z') });
    const ids = [];
    for (let i = 0; i < 25; i += 1) {
      const entry = svc.joinQueue(users.ana, queueId);
      svc.cancelEntry(users.ana, entry.id);
      ids.unshift(entry.id);
    }
    const first = (await myHistory('ana')).body.data;
    expect(first).toMatchObject({ page: 1, pageSize: 20, total: 25, totalPages: 2 });
    expect(first.items.map(item => item.entryId)).toEqual(ids.slice(0, 20));
    const second = (await myHistory('ana', '?page=2')).body.data;
    expect(second.items.map(item => item.entryId)).toEqual(ids.slice(20));
    expect((await myHistory('ana', '?pageSize=100')).body.data.items).toHaveLength(25);
    expect((await myHistory('ana', '?page=3')).body.data.items).toEqual([]);
    for (const query of ['?pageSize=101', '?pageSize=0', '?page=0', '?page=abc', '?outcome=left', '?sort=asc']) {
      const res = await myHistory('ana', query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('requires a signed-in user', async () => {
    expect((await request(app).get('/api/me/queue-history')).status).toBe(401);
  });

  test('history survives a backend restart', async () => {
    const { served } = await visits();
    const before = (await myHistory('ana')).body.data;
    app.locals.stopSubscribers();
    db.close();
    boot();
    const after = (await myHistory('ana')).body.data;
    expect(after).toEqual(before);
    expect(after.items.at(-1).entryId).toBe(served.id);
  });

  test('history built through the queue API matches what happened', async () => {
    const service = await openService();
    await as('ana', 'post', `/api/services/${service.id}/queue/join`).send({});
    await as('admin', 'post', `/api/admin/services/${service.id}/queue/serve-next`);
    await as('ana', 'post', `/api/services/${service.id}/queue/join`).send({});
    await as('ana', 'delete', `/api/services/${service.id}/queue/me`);
    const items = (await myHistory('ana')).body.data.items;
    expect(items.map(item => item.outcome).sort()).toEqual(['canceled', 'served']);
    expect(items.every(item => item.serviceName === 'Student Advising' && item.endedAt >= item.joinedAt)).toBe(true);
  });
});

describe('GET /api/admin/queue-history', () => {
  test('admins see every user\'s history and can filter by user and outcome', async () => {
    const { bens, served } = await visits();
    const all = (await allHistory()).body.data;
    expect(all.total).toBe(4);
    expect(all.items[0].entryId).toBe(bens.id);
    const ben = (await allHistory(`?userId=${users.ben.id}`)).body.data.items.map(item => item.entryId);
    expect(ben).toEqual([bens.id]);
    const anaServed = (await allHistory(`?userId=${users.ana.id}&outcome=served`)).body.data.items;
    expect(anaServed.map(item => item.entryId)).toEqual([served.id]);
  });

  test('regular users are refused and signed-out callers get 401', async () => {
    expect((await as('ana', 'get', '/api/admin/queue-history')).status).toBe(403);
    expect((await request(app).get('/api/admin/queue-history')).status).toBe(401);
  });
});

describe('contract functions', () => {
  test('listMyQueueHistory needs an actor and listQueueHistory needs an admin', async () => {
    const svc = createQueueEntryService({ db, store, events: app.locals.events });
    expect(() => svc.listMyQueueHistory(undefined)).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => svc.listQueueHistory(users.ana)).toThrow(expect.objectContaining({ status: 403 }));
    expect(svc.listMyQueueHistory(users.ana)).toMatchObject({ items: [], total: 0 });
    expect(svc.listQueueHistory(users.admin)).toMatchObject({ items: [], total: 0 });
  });

  test('ties on finish time are ordered by entry id, newest first', async () => {
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const fixed = () => new Date('2026-11-06T12:00:00.000Z');
    const svc = createQueueEntryService({ db, store, events: app.locals.events, now: fixed });
    const ids = [users.ana, users.ben].map(user => svc.joinQueue(user, queueId).id);
    ids.forEach(id => svc.cancelEntry(users.admin, id));
    const items = svc.listQueueHistory(users.admin).items.map(item => item.entryId);
    expect(items).toEqual([...ids].sort().reverse());
  });

  test('the repository falls back to page 1 and ignores unknown statuses', async () => {
    const { served } = await visits();
    const repo = createQueueEntryRepository(db);
    const result = repo.pageHistory({ userId: users.ana.id, status: 'waiting', page: 0 });
    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(repo.pageHistory().total).toBe(4);
    expect(repo.pageHistory({ userId: users.ana.id, status: 'served' }).items[0].id).toBe(served.id);
  });
});