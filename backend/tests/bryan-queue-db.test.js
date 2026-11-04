const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { EVENTS } = require('../src/shared/events');
const { openDatabase, withWriteTransaction } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createServiceRepository } = require('../src/modules/abel/serviceRepository');
const { createQueueEntryService } = require('../src/modules/bryan/queueEntryService');
const { createQueueEntryRepository } = require('../src/modules/bryan/queueEntryRepository');
const c = require('../src/shared/contracts');

const person = (name, role = 'user') => ({ id: randomUUID(), name, email: `${name.toLowerCase()}@example.com`, role });
const users = { admin: person('Admin', 'admin'), ana: person('Ana'), ben: person('Ben'), cy: person('Cy') };
const advising = { name: 'Student Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priority: 'medium' };

let dir;
let file;
let db;
let store;
let app;
let log;

function boot() {
  db = openDatabase({ filename: file });
  runMigrations(db);
  Object.values(users).forEach(u => db.prepare(`INSERT OR IGNORE INTO user_credentials (id, email, password_hash, role)
    VALUES (?, ?, 'test-hash', ?)`).run(u.id, u.email, u.role === 'admin' ? 'Administrator' : 'User'));
  store = createStore();
  app = createApp({ store, db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
  log = [];
  for (const name of Object.values(EVENTS)) app.locals.events.subscribe(name, ({ entry }) => log.push([name, entry]));
}
const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);
const createService = async (body = advising) => (await as('admin', 'post', '/api/services').send(body)).body.data;
const setOpen = (id, isOpen) => as('admin', 'patch', `/api/admin/services/${id}/queue`).send({ isOpen });
const openService = async body => { const s = await createService(body); await setOpen(s.id, true); return s; };
const join = (who, id) => as(who, 'post', `/api/services/${id}/queue/join`).send({});
const leave = (who, id) => as(who, 'delete', `/api/services/${id}/queue/me`);
const status = (who, id) => as(who, 'get', `/api/services/${id}/queue/me`);
const rowsFor = userId => db.prepare('SELECT * FROM queue_entry WHERE user_id = ? ORDER BY joined_at, id')
  .all(userId).map(r => ({ ...r }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-bryan-db-'));
  file = path.join(dir, 'test.sqlite');
  boot();
});

afterEach(() => {
  app.locals.stopSubscribers();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('join', () => {
  test('stores a waiting entry in SQLite and answers with the A3 queueStatus', async () => {
    const service = await openService();
    const res = await join('ana', service.id);
    expect(res.status).toBe(201);
    expect(c.queueStatus.parse(res.body.data)).toEqual(res.body.data);
    expect(res.body.data).toMatchObject({ position: 1, estimatedWaitMinutes: 0,
      entry: { serviceId: service.id, userId: users.ana.id, priority: 'medium', status: 'waiting' } });
    const [row] = rowsFor(users.ana.id);
    expect(row).toMatchObject({ id: res.body.data.entry.id, status: 'waiting', position: 1, priority_level: 1,
      finished_at: null });
    expect(log.map(([name]) => name)).toEqual([EVENTS.JOINED, EVENTS.NEAR]);
    expect(store.queueEntries.get(row.id)).toEqual(res.body.data.entry); 
  });

  test('later users are placed behind with a wait estimate from the service duration', async () => {
    const service = await openService();
    await join('ana', service.id);
    const res = await join('ben', service.id);
    expect(res.body.data).toMatchObject({ position: 2, estimatedWaitMinutes: 15 });
  });

  test('entry priority is copied from the service and cannot be sent by the user', async () => {
    const service = await openService({ ...advising, priority: 'high' });
    expect((await join('ana', service.id)).body.data.entry.priority).toBe('high');
    expect(rowsFor(users.ana.id)[0].priority_level).toBe(2);
    const sneaky = await as('ben', 'post', `/api/services/${service.id}/queue/join`)
      .send({ priority: 'high', userId: users.ana.id });
    expect(sneaky.status).toBe(400);
    expect(rowsFor(users.ben.id)).toEqual([]);
  });

  test('a duplicate waiting entry is rejected with 409 and nothing is stored or published', async () => {
    const service = await openService();
    await join('ana', service.id);
    log.length = 0;
    const res = await join('ana', service.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_IN_QUEUE');
    expect(rowsFor(users.ana.id)).toHaveLength(1);
    expect(log).toEqual([]);
  });

  test('closed queues and inactive services reject new joins', async () => {
    const closed = await createService();
    const res = await join('ana', closed.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_CLOSED');
    const inactive = await openService();
    createServiceRepository(db).update(inactive.id, { isActive: false });
    const res2 = await join('ana', inactive.id);
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('SERVICE_INACTIVE');
    expect(rowsFor(users.ana.id)).toEqual([]);
  });

  test('unknown services return 404, missing login 401, and deleted accounts 401', async () => {
    expect((await join('ana', randomUUID())).status).toBe(404);
    const service = await openService();
    expect((await request(app).post(`/api/services/${service.id}/queue/join`).send({})).status).toBe(401);
    const ghost = person('Ghost'); 
    users.ghost = ghost;
    const res = await join('ghost', service.id);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    delete users.ghost;
  });

  test('one user can wait in several services at once', async () => {
    const a = await openService();
    const b = await openService({ ...advising, name: 'Technical Support' });
    expect((await join('ana', a.id)).status).toBe(201);
    expect((await join('ana', b.id)).status).toBe(201);
    expect(rowsFor(users.ana.id).map(r => r.status)).toEqual(['waiting', 'waiting']);
  });
});

describe('status', () => {
  test('returns the caller\'s own position and wait, or 404 when not waiting', async () => {
    const service = await openService();
    await join('ana', service.id);
    await join('ben', service.id);
    const res = await status('ben', service.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ position: 2, estimatedWaitMinutes: 15,
      entry: { userId: users.ben.id } });
    const missing = await status('cy', service.id);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_IN_QUEUE');
    expect((await status('cy', randomUUID())).status).toBe(404);
  });
});

describe('leave', () => {
  test('cancels instead of deleting, renumbers the queue, and shows "left" in the API', async () => {
    const service = await openService();
    const mine = (await join('ana', service.id)).body.data.entry;
    await join('ben', service.id);
    log.length = 0;
    const res = await leave('ana', service.id);
    expect(res.status).toBe(200);
    expect(res.body.data.entry).toMatchObject({ id: mine.id, status: 'left' });
    const [row] = rowsFor(users.ana.id);
    expect(row).toMatchObject({ status: 'canceled', position: 0 });
    expect(row.finished_at).not.toBeNull();
    expect(log.map(([name]) => name)).toEqual([EVENTS.LEFT]);
    expect((await status('ben', service.id)).body.data).toMatchObject({ position: 1, estimatedWaitMinutes: 0 });
    expect((await leave('ana', service.id)).status).toBe(404);
  });

  test('works on a closed queue, and rejoining creates a new entry at the back', async () => {
    const service = await openService();
    const first = (await join('ana', service.id)).body.data.entry;
    await join('ben', service.id);
    await setOpen(service.id, false);
    expect((await leave('ana', service.id)).status).toBe(200);
    await setOpen(service.id, true);
    const again = await join('ana', service.id);
    expect(again.body.data.entry.id).not.toBe(first.id);
    expect(again.body.data.position).toBe(2);
    expect(rowsFor(users.ana.id).map(r => r.status)).toEqual(['canceled', 'waiting']);
  });

  test('unknown service returns 404', async () => {
    expect((await leave('ana', randomUUID())).status).toBe(404);
  });
});

describe('cancelEntry contract', () => {
  const svc = () => createQueueEntryService({ db, store, events: app.locals.events });

  test('owner cancels once; repeating is a successful no-op', async () => {
    const service = await openService();
    const entry = (await join('ana', service.id)).body.data.entry;
    log.length = 0;
    const first = svc().cancelEntry(users.ana, entry.id);
    expect(first).toMatchObject({ changed: true, canceledAs: 'left', entry: { status: 'canceled', position: 0 } });
    const again = svc().cancelEntry(users.ana, entry.id);
    expect(again.changed).toBe(false);
    expect(log.map(([name]) => name)).toEqual([EVENTS.LEFT]);
  });

  test('canceling a served entry is 409 ENTRY_FINALIZED', async () => {
    const service = await openService();
    const entry = (await join('ana', service.id)).body.data.entry;
    createQueueEntryRepository(db).finishEntry(entry.id, 'served');
    expect(() => svc().cancelEntry(users.ana, entry.id))
      .toThrow(expect.objectContaining({ status: 409, code: 'ENTRY_FINALIZED' }));
  });

  test('users cannot cancel other users\' entries; admins can, shown as "removed"', async () => {
    const service = await openService();
    const entry = (await join('ana', service.id)).body.data.entry;
    expect(() => svc().cancelEntry(users.ben, entry.id)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => svc().cancelEntry(users.ana, randomUUID())).toThrow(expect.objectContaining({ status: 404 }));
    log.length = 0;
    const removed = svc().cancelEntry(users.admin, entry.id);
    expect(removed).toMatchObject({ changed: true, canceledAs: 'removed' });
    expect(log).toEqual([[EVENTS.REMOVED, expect.objectContaining({ id: entry.id, status: 'removed' })]]);
  });

  test('a join inside a failed transaction is rolled back', async () => {
    const service = await openService();
    const queueId = db.prepare('SELECT id FROM queue WHERE service_id = ?').get(service.id).id;
    expect(() => withWriteTransaction(db, tx => {
      svc().joinInTransaction(tx, users.ana, queueId);
      throw new Error('boom');
    })).toThrow('boom');
    expect(rowsFor(users.ana.id)).toEqual([]);
    expect(svc().joinQueue(users.ana, queueId)).toMatchObject({ status: 'waiting', position: 1 });
  });
});

describe('restart', () => {
  test('waiting entries survive a backend restart and are reloaded for admin views', async () => {
    const service = await openService();
    await join('ana', service.id);
    await join('ben', service.id);
    app.locals.stopSubscribers();
    db.close();
    boot(); 
    expect(store.queueEntries.size).toBe(2);
    expect((await status('ben', service.id)).body.data).toMatchObject({ position: 2, estimatedWaitMinutes: 15 });
    const adminView = await as('admin', 'get', `/api/admin/services/${service.id}/queue`);
    expect(adminView.body.data.map(s => s.entry.userId)).toEqual([users.ana.id, users.ben.id]);
  });
});