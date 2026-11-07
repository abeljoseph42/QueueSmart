const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { EVENTS } = require('../src/shared/events');
const { openDatabase, withWriteTransaction } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createQueueEntryService } = require('../src/modules/bryan/queueEntryService');
const { createNotificationService } = require('../src/modules/heera/notificationService');
const { createQueueEntryRepository } = require('../src/modules/bryan/queueEntryRepository');

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

function addUser(conn, user) {
  conn.prepare(`INSERT OR IGNORE INTO user_credentials (id, email, password_hash, role)
    VALUES (?, ?, 'test-hash', ?)`).run(user.id, user.email, user.role === 'admin' ? 'Administrator' : 'User');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-bryan-serve-'));
  file = path.join(dir, 'test.sqlite');
  db = openDatabase({ filename: file });
  runMigrations(db);
  Object.values(users).forEach(user => addUser(db, user));
  store = createStore();
  app = createApp({ store, db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
  log = [];
  for (const name of Object.values(EVENTS)) app.locals.events.subscribe(name, ({ entry }) => log.push([name, entry]));
});

afterEach(() => {
  app.locals.stopSubscribers();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);
const createService = async (body = advising) => (await as('admin', 'post', '/api/services').send(body)).body.data;
const setOpen = (id, isOpen) => as('admin', 'patch', `/api/admin/services/${id}/queue`).send({ isOpen });
const openService = async body => { const s = await createService(body); await setOpen(s.id, true); return s; };
const nextMillisecond = async () => {
  const start = Date.now();
  while (Date.now() === start) await new Promise(resolve => setImmediate(resolve));
};
const join = async (who, id) => {
  const res = await as(who, 'post', `/api/services/${id}/queue/join`).send({});
  await nextMillisecond();
  return res;
};
const serve = (who, id) => as(who, 'post', `/api/admin/services/${id}/queue/serve-next`);
const adminQueue = id => as('admin', 'get', `/api/admin/services/${id}/queue`);
const setPriority = (who, id, entryId, body) => as(who, 'patch', `/api/admin/services/${id}/queue/${entryId}`).send(body);
const remove = (who, id, entryId) => as(who, 'delete', `/api/admin/services/${id}/queue/${entryId}`);
const queueIdOf = serviceId => db.prepare('SELECT id FROM queue WHERE service_id = ?').get(serviceId).id;
const row = entryId => ({ ...db.prepare('SELECT * FROM queue_entry WHERE id = ?').get(entryId) });
const waitingUsers = async id => (await adminQueue(id)).body.data.map(s => s.entry.userId);

async function threeWaiting(service) {
  const ana = (await join('ana', service.id)).body.data.entry;
  const ben = (await join('ben', service.id)).body.data.entry;
  const cy = (await join('cy', service.id)).body.data.entry;
  return { ana, ben, cy };
}

describe('serve-next', () => {
  test('serves position 1, stores it as served, and moves everyone up', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    log.length = 0;
    const res = await serve('admin', service.id);
    expect(res.status).toBe(200);
    expect(res.body.data.entry).toMatchObject({ id: ana.id, userId: users.ana.id, status: 'served' });
    expect(row(ana.id)).toMatchObject({ status: 'served', position: 0 });
    expect(row(ana.id).finished_at).not.toBeNull();
    expect(log.map(([name]) => name)).toEqual([EVENTS.SERVED, EVENTS.NEAR]);
    const queue = (await adminQueue(service.id)).body.data;
    expect(queue.map(s => [s.entry.userId, s.position, s.estimatedWaitMinutes]))
      .toEqual([[users.ben.id, 1, 0], [users.cy.id, 2, 15]]);
    expect(store.queueEntries.get(ana.id).status).toBe('served');
  });

  test('empty queues return 409 QUEUE_EMPTY and unknown services 404', async () => {
    const service = await openService();
    const res = await serve('admin', service.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'QUEUE_EMPTY', message: 'Queue is empty.' });
    expect((await serve('admin', randomUUID())).status).toBe(404);
  });

  test('a closed queue can still be served until it is drained', async () => {
    const service = await openService();
    await join('ana', service.id);
    await join('ben', service.id);
    await setOpen(service.id, false);
    expect((await serve('admin', service.id)).body.data.entry.userId).toBe(users.ana.id);
    expect((await serve('admin', service.id)).body.data.entry.userId).toBe(users.ben.id);
    expect((await serve('admin', service.id)).body.error.code).toBe('QUEUE_EMPTY');
  });

  test('served users can join again and get a new entry at the back', async () => {
    const service = await openService();
    const first = (await join('ana', service.id)).body.data.entry;
    await join('ben', service.id);
    await serve('admin', service.id);
    const again = (await join('ana', service.id)).body.data;
    expect(again.entry.id).not.toBe(first.id);
    expect(again.position).toBe(2);
  });

  test('a served entry survives a restart and is not reloaded as waiting', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    await serve('admin', service.id);
    app.locals.stopSubscribers();
    db.close();
    db = openDatabase({ filename: file });
    store = createStore();
    app = createApp({ store, db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
    expect(store.queueEntries.has(ana.id)).toBe(false);
    expect(await waitingUsers(service.id)).toEqual([users.ben.id, users.cy.id]);
    expect(row(ana.id).status).toBe('served');
  });
});

describe('priority', () => {
  test('raising an entry priority moves it ahead and renumbers the queue', async () => {
    const service = await openService();
    const { cy } = await threeWaiting(service);
    const res = await setPriority('admin', service.id, cy.id, { priority: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(s => [s.entry.userId, s.entry.priority, s.position, s.estimatedWaitMinutes])).toEqual([
      [users.cy.id, 'high', 1, 0], [users.ana.id, 'medium', 2, 15], [users.ben.id, 'medium', 3, 30]]);
    expect(row(cy.id)).toMatchObject({ priority_level: 2, position: 1 });
    expect((await serve('admin', service.id)).body.data.entry.userId).toBe(users.cy.id);
  });

  test('lowering a priority moves the entry behind, and users see their new position', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    await setPriority('admin', service.id, ana.id, { priority: 'low' });
    expect(await waitingUsers(service.id)).toEqual([users.ben.id, users.cy.id, users.ana.id]);
    const mine = (await as('ana', 'get', `/api/services/${service.id}/queue/me`)).body.data;
    expect(mine).toMatchObject({ position: 3, estimatedWaitMinutes: 30, entry: { priority: 'low' } });
    const dashboard = (await as('ana', 'get', '/api/me/dashboard')).body.data;
    expect(dashboard.queues).toEqual([mine]);
  });

  test('the same priority is a no-op; bad bodies return 400 and manual positions 409', async () => {
    const service = await openService();
    const { ana, ben } = await threeWaiting(service);
    expect((await setPriority('admin', service.id, ana.id, { priority: 'medium' })).status).toBe(200);
    expect(await waitingUsers(service.id)).toEqual([users.ana.id, users.ben.id, users.cy.id]);
    expect((await setPriority('admin', service.id, ana.id, { priority: 'urgent' })).status).toBe(400);
    expect((await setPriority('admin', service.id, ana.id, {})).status).toBe(400);
    const moved = await setPriority('admin', service.id, ben.id, { position: 1 });
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('MANUAL_REORDER_DISABLED');
    expect(await waitingUsers(service.id)).toEqual([users.ana.id, users.ben.id, users.cy.id]);
  });

  test('entries that are finished, missing, or in another service return 404', async () => {
    const service = await openService();
    const other = await openService({ ...advising, name: 'Technical Support' });
    const { ana, ben } = await threeWaiting(service);
    await serve('admin', service.id);
    expect((await setPriority('admin', service.id, ana.id, { priority: 'high' })).status).toBe(404);
    expect((await setPriority('admin', other.id, ben.id, { priority: 'high' })).status).toBe(404);
    expect((await setPriority('admin', service.id, randomUUID(), { priority: 'high' })).status).toBe(404);
  });
});

describe('admin remove', () => {
  test('cancels the entry, shows "removed", and renumbers the queue', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    log.length = 0;
    const res = await remove('admin', service.id, ana.id);
    expect(res.status).toBe(200);
    expect(res.body.data.entry).toMatchObject({ id: ana.id, status: 'removed' });
    expect(row(ana.id)).toMatchObject({ status: 'canceled', position: 0 });
    expect(log[0]).toEqual([EVENTS.REMOVED, expect.objectContaining({ id: ana.id })]);
    expect(await waitingUsers(service.id)).toEqual([users.ben.id, users.cy.id]);
    expect((await remove('admin', service.id, ana.id)).status).toBe(404);
  });
});

describe('permissions', () => {
  test('only administrators can view, serve, reprioritize, or remove entries', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    for (const res of [
      await as('ana', 'get', `/api/admin/services/${service.id}/queue`),
      await serve('ana', service.id),
      await setPriority('ana', service.id, ana.id, { priority: 'high' }),
      await remove('ben', service.id, ana.id),
    ]) expect(res.status).toBe(403);
    expect((await request(app).post(`/api/admin/services/${service.id}/queue/serve-next`)).status).toBe(401);
    expect(await waitingUsers(service.id)).toEqual([users.ana.id, users.ben.id, users.cy.id]);
    expect(row(ana.id).priority_level).toBe(1);
  });

  test('the contract functions also refuse non-admin actors', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    const svc = createQueueEntryService({ db, store, events: app.locals.events });
    const queueId = queueIdOf(service.id);
    expect(() => svc.serveNext(users.ana, queueId)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => svc.setEntryPriority(users.ana, ana.id, 2)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => svc.serveNext(undefined, queueId)).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('contract functions', () => {
  const svc = (options = {}) => createQueueEntryService({ db, store, events: app.locals.events, ...options });

  test('serveNext and setEntryPriority return persisted entry objects', async () => {
    const service = await openService();
    const { ana, ben } = await threeWaiting(service);
    const queueId = queueIdOf(service.id);
    expect(svc().setEntryPriority(users.admin, ben.id, 2)).toMatchObject({ id: ben.id, queueId,
      userId: users.ben.id, priorityLevel: 2, position: 1, status: 'waiting', finishedAt: null });
    expect(svc().serveNext(users.admin, queueId)).toMatchObject({ id: ben.id, status: 'served', position: 0 });
    expect(svc().setEntryPriority(users.admin, ana.id, 1)).toMatchObject({ position: 1, priorityLevel: 1 });
  });

  test('invalid levels are 400, unknown entries 404, finished entries 409, unknown queues 404', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    expect(() => svc().setEntryPriority(users.admin, ana.id, 3)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => svc().setEntryPriority(users.admin, ana.id, '2')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => svc().setEntryPriority(users.admin, randomUUID(), 2)).toThrow(expect.objectContaining({ status: 404 }));
    svc().serveNext(users.admin, queueIdOf(service.id));
    expect(() => svc().setEntryPriority(users.admin, ana.id, 2))
      .toThrow(expect.objectContaining({ status: 409, code: 'ENTRY_FINALIZED' }));
    expect(() => svc().serveNext(users.admin, randomUUID())).toThrow(expect.objectContaining({ status: 404 }));
  });

  test('ties in priority and join time are broken by entry id', async () => {
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const fixed = svc({ now: () => new Date('2026-11-04T12:00:00.000Z') });
    const joined = [users.ana, users.ben, users.cy].map(user => fixed.joinQueue(user, queueId));
    const byId = [...joined].sort((a, b) => a.id.localeCompare(b.id)).map(entry => entry.id);
    expect((await adminQueue(service.id)).body.data.map(s => s.entry.id)).toEqual(byId);
  });

  test('a serve inside a failed transaction is rolled back', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    expect(() => withWriteTransaction(db, tx => {
      svc().serveInTransaction(tx, users.admin, queueIdOf(service.id));
      throw new Error('boom');
    })).toThrow('boom');
    expect(row(ana.id)).toMatchObject({ status: 'waiting', position: 1 });
  });

  test('getEntryStats counts waiting, served, and canceled entries', async () => {
    expect(svc().getEntryStats()).toEqual({ waitingCount: 0, servedCount: 0, canceledCount: 0 });
    const service = await openService();
    const { cy } = await threeWaiting(service);
    await serve('admin', service.id);
    await remove('admin', service.id, cy.id);
    expect(svc().getEntryStats()).toEqual({ waitingCount: 1, servedCount: 1, canceledCount: 1 });
  });

  test('the repository only changes the priority of waiting entries', async () => {
    const service = await openService();
    const { ana } = await threeWaiting(service);
    const repo = createQueueEntryRepository(db);
    expect(repo.updatePriority(randomUUID(), 2)).toBeNull();
    repo.finishEntry(ana.id, 'served');
    expect(repo.updatePriority(ana.id, 2)).toBeNull();
    expect(row(ana.id).priority_level).toBe(1);
  });
});

describe('notifications', () => {
  const notificationRows = userId => db.prepare(`SELECT type, event_key, status, message FROM notification
    WHERE user_id = ? ORDER BY created_at, rowid`).all(userId).map(r => ({ ...r }));

  test('joining and being served through the API each store one notification', async () => {
    const service = await openService();
    const entry = (await join('ana', service.id)).body.data.entry;
    await join('ana', service.id);
    await serve('admin', service.id);
    expect(notificationRows(users.ana.id).map(({ status, ...rest }) => rest)).toEqual([
      { type: 'queue.joined', event_key: `queue.joined:${entry.id}`,
        message: 'You joined the Student Advising queue.' },
      { type: 'queue.served', event_key: `queue.served:${entry.id}`,
        message: 'You have been served at Student Advising.' },
    ]);
    const mine = (await as('ana', 'get', '/api/me/notifications')).body.data.items.map(n => n.type);
    expect(mine).toEqual(['queue.served', 'queue.joined']);
    expect((await as('ben', 'get', '/api/me/notifications')).body.data.items).toEqual([]);
  });

  test('leaving, removal, priority changes, and failed joins send nothing', async () => {
    const service = await openService();
    const { ana, ben, cy } = await threeWaiting(service);
    await as('ana', 'delete', `/api/services/${service.id}/queue/me`);
    await remove('admin', service.id, ben.id);
    await setPriority('admin', service.id, cy.id, { priority: 'high' });
    const closed = await createService({ ...advising, name: 'Closed Desk' });
    await join('ana', closed.id);
    expect(notificationRows(users.ana.id).map(n => n.event_key)).toEqual([`queue.joined:${ana.id}`]);
    expect(notificationRows(users.ben.id).map(n => n.type)).toEqual(['queue.joined']);
    expect(notificationRows(users.cy.id).map(n => n.type)).toEqual(['queue.joined']);
  });

  test('the email is sent after commit with the user address, subject, and message', async () => {
    const send = jest.fn(async () => {});
    const notifications = createNotificationService(db, { send });
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const svc = createQueueEntryService({ db, store, events: app.locals.events, notifications });
    svc.joinQueue(users.ana, queueId);
    svc.serveNext(users.admin, queueId);
    await svc.settled();
    expect(send.mock.calls.map(([mail]) => [mail.to, mail.subject, mail.text])).toEqual([
      [users.ana.email, 'Joined Student Advising', 'You joined the Student Advising queue.'],
      [users.ana.email, 'Served at Student Advising', 'You have been served at Student Advising.'],
    ]);
  });

  test('a failed email is recorded as failed and does not undo the join or the serve', async () => {
    const notifications = createNotificationService(db, { send: async () => { throw new Error('SMTP down'); } });
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const svc = createQueueEntryService({ db, store, events: app.locals.events, notifications });
    const entry = svc.joinQueue(users.ana, queueId);
    svc.serveNext(users.admin, queueId);
    await svc.settled();
    expect(row(entry.id).status).toBe('served');
    expect(notificationRows(users.ana.id).map(n => n.status)).toEqual(['failed', 'failed']);
    expect(notifications.listForUser(users.ana.id).items[0].lastError).toBe('SMTP down');
  });

  test('a rolled-back join or serve leaves no notification behind', async () => {
    const notifications = createNotificationService(db, { send: jest.fn() });
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const svc = createQueueEntryService({ db, store, events: app.locals.events, notifications });
    expect(() => withWriteTransaction(db, tx => {
      svc.joinInTransaction(tx, users.ana, queueId);
      throw new Error('boom');
    })).toThrow('boom');
    svc.joinQueue(users.ben, queueId);
    await svc.settled();
    expect(() => withWriteTransaction(db, tx => {
      svc.serveInTransaction(tx, users.admin, queueId);
      throw new Error('boom');
    })).toThrow('boom');
    expect(notificationRows(users.ana.id)).toEqual([]);
    expect(notificationRows(users.ben.id).map(n => n.type)).toEqual(['queue.joined']);
  });

  test('without a notification service nothing is queued and settled resolves', async () => {
    const service = await openService();
    const svc = createQueueEntryService({ db, store, events: app.locals.events });
    svc.joinQueue(users.cy, queueIdOf(service.id));
    await expect(svc.settled()).resolves.toBeUndefined();
    expect(notificationRows(users.cy.id)).toEqual([]);
  });
});

describe('concurrency (separate connections to the same file)', () => {
  async function race(jobs) {
    const gate = new SharedArrayBuffer(8);
    const flag = new Int32Array(gate);
    const workers = jobs.map(job => new Worker(path.join(__dirname, 'bryan-queue.worker.js'),
      { workerData: { file, gate, ...job } }));
    const results = workers.map(worker => new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    }));
    while (Atomics.load(flag, 1) < workers.length) await new Promise(resolve => setTimeout(resolve, 5));
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    try {
      return await Promise.all(results);
    } finally {
      await Promise.all(workers.map(worker => worker.terminate()));
    }
  }

  test('simultaneous joins by different users get unique positions 1..N', async () => {
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const crowd = Array.from({ length: 6 }, (_, i) => person(`Crowd${i}`));
    crowd.forEach(user => addUser(db, user));
    const results = await race(crowd.map(actor => ({ action: 'join', actor, queueId })));
    expect(results.every(result => result.ok)).toBe(true);
    const positions = db.prepare(`SELECT position FROM queue_entry WHERE queue_id = ? AND status = 'waiting'
      ORDER BY position`).all(queueId).map(r => r.position);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6]);
  }, 20000);

  test('simultaneous duplicate joins by one user store exactly one entry', async () => {
    const service = await openService();
    const queueId = queueIdOf(service.id);
    const results = await race(Array.from({ length: 4 }, () => ({ action: 'join', actor: users.ana, queueId })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok).map(result => result.code))
      .toEqual(['ALREADY_IN_QUEUE', 'ALREADY_IN_QUEUE', 'ALREADY_IN_QUEUE']);
    expect(db.prepare('SELECT count(*) AS n FROM queue_entry WHERE user_id = ?').get(users.ana.id).n).toBe(1);
  }, 20000);

  test('two admins serving at once serve two different users', async () => {
    const service = await openService();
    await threeWaiting(service);
    const queueId = queueIdOf(service.id);
    const results = await race([{ action: 'serve', actor: users.admin, queueId },
      { action: 'serve', actor: users.admin, queueId }]);
    expect(new Set(results.map(result => result.entry.userId))).toEqual(new Set([users.ana.id, users.ben.id]));
    expect(await waitingUsers(service.id)).toEqual([users.cy.id]);
  }, 20000);

  test('a write blocked by another connection returns 503 DATABASE_BUSY and stores nothing', async () => {
    const service = await openService();
    const locker = openDatabase({ filename: file });
    locker.exec('PRAGMA busy_timeout = 0');
    db.exec('PRAGMA busy_timeout = 0');
    locker.exec('BEGIN IMMEDIATE');
    try {
      const res = await join('ana', service.id);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DATABASE_BUSY');
    } finally {
      locker.exec('ROLLBACK');
      locker.close();
    }
    expect(db.prepare('SELECT count(*) AS n FROM queue_entry').get().n).toBe(0);
  });
});