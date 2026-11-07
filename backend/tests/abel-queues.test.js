const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createServiceRepository } = require('../src/modules/abel/serviceRepository');
const { QUEUE_STATUSES, createQueueRepository, assertJoinable } = require('../src/modules/abel/queueRepository');

const MIGRATIONS = path.join(__dirname, '../src/database/migrations');
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const users = {
  admin: { id: '00000000-0000-4000-8000-000000000001', name: 'Test Admin', email: 'admin@example.com', role: 'admin' },
  ana: { id: '00000000-0000-4000-8000-000000000002', name: 'Ana', email: 'ana@example.com', role: 'user' },
  ben: { id: '00000000-0000-4000-8000-000000000003', name: 'Ben', email: 'ben@example.com', role: 'user' },
  cy: { id: '00000000-0000-4000-8000-000000000004', name: 'Cy', email: 'cy@example.com', role: 'user' },
};
const advising = { name: 'Student Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priority: 'medium' };

let dir;
let file;
let db;
let store;
let app;

const boot = () => {
  db = openDatabase({ filename: file });
  runMigrations(db);
  Object.values(users).forEach(user => db.prepare(`INSERT OR IGNORE INTO user_credentials (id, email, password_hash, role)
    VALUES (?, ?, 'test-hash', ?)`).run(user.id, user.email, user.role === 'admin' ? 'Administrator' : 'User'));
  store = createStore();
  app = createApp({ store, db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
};
const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);
const createService = async () => (await as('admin', 'post', '/api/services').send(advising)).body.data;
const setOpen = (id, isOpen) => as('admin', 'patch', `/api/admin/services/${id}/queue`).send({ isOpen });
const queueRows = () => db.prepare('SELECT * FROM queue ORDER BY rowid').all().map(row => ({ ...row }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-abel-queues-'));
  file = path.join(dir, 'test.sqlite');
  boot();
});

afterEach(() => {
  app.locals.stopSubscribers();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('004_queues migration', () => {
  test('applies after 001-003', () => {
    const names = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(row => row.name);
    expect(names.slice(0, 4)).toEqual(['001_user_credentials.sql', '002_user_profile.sql', '003_services.sql',
      '004_queues.sql']);
  });

  test('backfills one closed queue for services that existed before it', () => {
    const staged = path.join(dir, 'migrations');
    fs.mkdirSync(staged);
    const copy = name => fs.copyFileSync(path.join(MIGRATIONS, name), path.join(staged, name));
    ['001_user_credentials.sql', '002_user_profile.sql', '003_services.sql'].forEach(copy);
    const old = openDatabase({ filename: path.join(dir, 'old.sqlite') });
    try {
      runMigrations(old, staged);
      const service = createServiceRepository(old).create({ name: 'IT Help Desk', expectedDurationMinutes: 10 });
      copy('004_queues.sql');
      expect(runMigrations(old, staged)).toEqual(['004_queues.sql']);
      const [row] = old.prepare('SELECT * FROM queue').all();
      expect(row).toMatchObject({ service_id: service.id, status: 'closed' });
      expect(row.id).toMatch(UUID_V4);
      expect(row.created_at).toMatch(UTC_MS);
    } finally {
      old.close();
    }
  });

  const insert = row => db.prepare('INSERT INTO queue (id, service_id, status, created_at) VALUES (?, ?, ?, ?)')
    .run(row.id ?? randomUUID(), row.serviceId, row.status ?? 'closed', row.createdAt ?? new Date().toISOString());

  test('database constraints reject invalid queues', async () => {
    const { id } = await createService();
    const other = createServiceRepository(db).create({ name: 'DMV Services', expectedDurationMinutes: 20 });
    expect(() => insert({ serviceId: other.id, status: 'paused' })).toThrow(/CHECK constraint failed/);
    expect(() => insert({ serviceId: other.id, createdAt: '2026-11-04 01:00:00' })).toThrow(/CHECK constraint failed/);
    expect(() => insert({ serviceId: other.id, createdAt: '2026-11-04T01:00:00Z' })).toThrow(/CHECK constraint failed/);
    expect(() => insert({ serviceId: other.id, id: 'short' })).toThrow(/CHECK constraint failed/);
    expect(() => insert({ serviceId: id })).toThrow(/UNIQUE constraint failed/);
    expect(() => insert({ serviceId: randomUUID() })).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => db.prepare('DELETE FROM service WHERE id = ?').run(id)).toThrow(/FOREIGN KEY constraint failed/);
    expect(createQueueRepository(db).createForService(other.id)).toMatchObject({ serviceId: other.id, status: 'closed' });
  });
});

describe('queue repository', () => {
  test('creating a service creates exactly one closed queue', async () => {
    const service = await createService();
    expect(service.isOpen).toBe(false);
    const rows = queueRows();
    expect(rows).toEqual([{ id: expect.stringMatching(UUID_V4), service_id: service.id, status: 'closed',
      created_at: expect.stringMatching(UTC_MS) }]);
    expect(createQueueRepository(db).getQueue(rows[0].id)).toEqual({ id: rows[0].id, serviceId: service.id,
      status: 'closed' });
  });

  test('a failed queue insert rolls back the service', async () => {
    db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT, 'queue failed'); END");
    const response = await as('admin', 'post', '/api/services').send(advising);
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    expect(db.prepare('SELECT count(*) AS n FROM service').get().n).toBe(0);
    expect(store.services.size).toBe(0);
  });

  test('open, close, and reopen reuse the same queue and are idempotent', async () => {
    const { id: serviceId } = await createService();
    const queues = createQueueRepository(db);
    const { id } = queues.findByServiceId(serviceId);
    expect(queues.setStatus(id, 'open')).toEqual({ id, serviceId, status: 'open' });
    expect(queues.setStatus(id, 'open').status).toBe('open');
    expect(queues.setStatus(id, 'closed').status).toBe('closed');
    expect(queues.setStatusByServiceId(serviceId, 'open')).toEqual({ id, serviceId, status: 'open' });
    expect(queueRows()).toHaveLength(1);
    expect(QUEUE_STATUSES).toEqual(['open', 'closed']);
  });

  test('missing queues and bad statuses are rejected', async () => {
    const { id: serviceId } = await createService();
    const queues = createQueueRepository(db);
    expect(queues.findByServiceId('missing')).toBeNull();
    expect(() => queues.getQueue('missing')).toThrow(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
    expect(() => queues.setStatus('missing', 'open')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => queues.setStatusByServiceId('missing', 'open')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => queues.setStatusByServiceId(serviceId, 'paused'))
      .toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
    expect(queueRows()[0].status).toBe('closed');
  });

  test('assertJoinable checks the queue status and service activity', async () => {
    const { id: serviceId } = await createService();
    const queues = createQueueRepository(db);
    const { id } = queues.findByServiceId(serviceId);
    expect(() => assertJoinable(db, id)).toThrow(expect.objectContaining({ status: 409, code: 'QUEUE_CLOSED' }));
    queues.setStatus(id, 'open');
    expect(assertJoinable(db, id)).toEqual({ queue: { id, serviceId, status: 'open' }, service: { id: serviceId,
      name: 'Student Advising', expectedDurationMinutes: 15, priorityLevel: 1, isActive: true } });
    createServiceRepository(db).update(serviceId, { isActive: false });
    expect(() => assertJoinable(db, id)).toThrow(expect.objectContaining({ status: 409, code: 'SERVICE_INACTIVE' }));
    expect(() => assertJoinable(db, 'missing')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('admin queue status API', () => {
  test('opening persists and survives a backend restart', async () => {
    const { id } = await createService();
    const opened = await setOpen(id, true);
    expect(opened.status).toBe(200);
    expect(opened.body.data).toEqual({ id, ...advising, isOpen: true, isActive: true });
    expect(queueRows()[0].status).toBe('open');

    app.locals.stopSubscribers();
    db.close();
    boot();
    expect((await request(app).get('/api/services')).body.data[0].isOpen).toBe(true);
    expect(store.services.get(id).isOpen).toBe(true);
    expect((await as('admin', 'get', '/api/admin/dashboard')).body.data).toMatchObject({ openServiceCount: 1 });
  });

  test('a closed queue blocks joins but lets waiting users leave and admins serve', async () => {
    const { id } = await createService();
    expect((await as('ana', 'post', `/api/services/${id}/queue/join`).send({})).body.error.code).toBe('QUEUE_CLOSED');
    await setOpen(id, true);
    expect((await as('ana', 'post', `/api/services/${id}/queue/join`).send({})).status).toBe(201);
    expect((await as('ben', 'post', `/api/services/${id}/queue/join`).send({})).status).toBe(201);

    await setOpen(id, false);
    const blocked = await as('cy', 'post', `/api/services/${id}/queue/join`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('QUEUE_CLOSED');
    expect((await as('admin', 'get', `/api/admin/services/${id}/queue`)).body.data).toHaveLength(2);

    expect((await as('ana', 'delete', `/api/services/${id}/queue/me`)).status).toBe(200);
    const served = await as('admin', 'post', `/api/admin/services/${id}/queue/serve-next`);
    expect(served.status).toBe(200);
    expect(served.body.data.entry).toMatchObject({ userId: users.ben.id, status: 'served' });

    await setOpen(id, true);
    expect(queueRows()).toHaveLength(1);
    expect((await as('cy', 'post', `/api/services/${id}/queue/join`).send({})).status).toBe(201);
  });

  test('unknown services return 404 and invalid bodies return 400', async () => {
    const missing = await setOpen('missing', true);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    const { id } = await createService();
    expect((await as('admin', 'patch', `/api/admin/services/${id}/queue`).send({ isOpen: 'yes' })).status).toBe(400);
    expect(queueRows()[0].status).toBe('closed');
  });

  test('changing queue status requires an administrator', async () => {
    const { id } = await createService();
    expect((await request(app).patch(`/api/admin/services/${id}/queue`).send({ isOpen: true })).status).toBe(401);
    expect((await as('ana', 'patch', `/api/admin/services/${id}/queue`).send({ isOpen: true })).status).toBe(403);
    expect(queueRows()[0].status).toBe('closed');
  });
});

describe('admin dashboard service and queue statistics', () => {
  test('counts services and queue states from SQLite and survive a restart', async () => {
    const first = await createService();
    const second = await createService();
    await createService();
    await setOpen(first.id, true);
    await as('admin', 'patch', `/api/services/${second.id}`).send({ isActive: false });
    const expected = { serviceCount: 3, activeServiceCount: 2, openQueueCount: 1, closedQueueCount: 2,
      openServiceCount: 1, waitingCount: 0, servedCount: 0, canceledCount: 0,
      appointmentCounts: { booked: 0, canceled: 0, completed: 0 } };
    expect((await as('admin', 'get', '/api/admin/dashboard')).body.data).toEqual(expected);

    app.locals.stopSubscribers();
    db.close();
    boot();
    expect((await as('admin', 'get', '/api/admin/dashboard')).body.data).toEqual(expected);
  });

  test('without a database the dashboard keeps the A3 fields only', async () => {
    const memoryApp = createApp({ resolveUser: async () => users.admin });
    expect((await request(memoryApp).get('/api/admin/dashboard')).body.data)
      .toEqual({ serviceCount: 0, waitingCount: 0, openServiceCount: 0 });
    memoryApp.locals.stopSubscribers();
  });
});