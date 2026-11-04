const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createServiceManager } = require('../src/modules/abel/serviceManager');

const admin = { id: '00000000-0000-4000-8000-000000000001', name: 'Test Admin', email: 'admin@example.com', role: 'admin' };
const member = { id: '00000000-0000-4000-8000-000000000002', name: 'Test User', email: 'user@example.com', role: 'user' };
const advising = { name: 'Student Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priority: 'medium' };

let dir;
let file;
let db;
let store;

const appAs = identity => createApp({ store, db, resolveUser: async () => identity });
const publicApp = () => createApp({ store, db });
const create = (body = advising) => request(appAs(admin)).post('/api/services').send(body);
const rows = () => db.prepare('SELECT * FROM service ORDER BY rowid').all().map(row => ({ ...row }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-abel-api-'));
  file = path.join(dir, 'test.sqlite');
  db = openDatabase({ filename: file });
  runMigrations(db);
  [admin, member].forEach(user => db.prepare(`INSERT OR IGNORE INTO user_credentials (id, email, password_hash, role)
    VALUES (?, ?, 'test-hash', ?)`).run(user.id, user.email, user.role === 'admin' ? 'Administrator' : 'User'));
  store = createStore();
});

afterEach(() => {
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an admin creates a service that is stored in SQLite and listed with the A3 shape', async () => {
  const created = await create();
  expect(created.status).toBe(201);
  expect(created.body.data).toEqual({ id: expect.any(String), ...advising, isOpen: false, isActive: true });
  expect(rows()).toEqual([{ id: created.body.data.id, name: 'Student Advising',
    description: 'Course planning help', expected_duration_minutes: 15, priority_level: 1, is_active: 1 }]);

  const listed = await request(publicApp()).get('/api/services');
  expect(listed.status).toBe(200);
  expect(listed.body.data).toEqual([created.body.data]);
});

test.each([['low', 0], ['medium', 1], ['high', 2]])('priority %s is stored as level %i and read back',
  async (priority, level) => {
    const created = await create({ ...advising, priority });
    expect(created.body.data.priority).toBe(priority);
    expect(rows()[0].priority_level).toBe(level);
  });

test('services survive a backend restart with the same id', async () => {
  const created = await create();
  db.close();
  db = openDatabase({ filename: file });
  runMigrations(db);
  store = createStore();

  const listed = await request(publicApp()).get('/api/services');
  expect(listed.body.data).toEqual([created.body.data]);
  expect(store.services.get(created.body.data.id)).toEqual(created.body.data);
});

test('PATCH updates only the supplied fields and persists them', async () => {
  const { id } = (await create()).body.data;
  const updated = await request(appAs(admin)).patch(`/api/services/${id}`)
    .send({ expectedDurationMinutes: 30, priority: 'high' });
  expect(updated.status).toBe(200);
  expect(updated.body.data).toEqual({ id, ...advising, expectedDurationMinutes: 30, priority: 'high',
    isOpen: false, isActive: true });
  expect(rows()[0]).toMatchObject({ expected_duration_minutes: 30, priority_level: 2 });
});

test('an admin can deactivate a service instead of deleting it', async () => {
  const { id } = (await create()).body.data;
  const updated = await request(appAs(admin)).patch(`/api/services/${id}`).send({ isActive: false });
  expect(updated.body.data.isActive).toBe(false);
  expect(rows()[0].is_active).toBe(0);
  expect((await request(publicApp()).get('/api/services')).body.data[0].isActive).toBe(false);
});

test('editing an unknown service returns 404 SERVICE_NOT_FOUND', async () => {
  const response = await request(appAs(admin)).patch('/api/services/missing').send({ name: 'X' });
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
});

test.each([
  ['missing name', { ...advising, name: undefined }],
  ['481 minute duration', { ...advising, expectedDurationMinutes: 481 }],
  ['unknown priority', { ...advising, priority: 'urgent' }],
  ['client-chosen isOpen', { ...advising, isOpen: false }],
])('invalid create (%s) returns 400 and stores nothing', async (_label, body) => {
  const response = await create(body);
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(rows()).toEqual([]);
});

test('invalid edits return 400 and leave the row unchanged', async () => {
  const { id } = (await create()).body.data;
  const before = rows();
  for (const body of [{}, { expectedDurationMinutes: 0 }, { isActive: 'no' }]) {
    expect((await request(appAs(admin)).patch(`/api/services/${id}`).send(body)).status).toBe(400);
  }
  expect(rows()).toEqual(before);
});

test('writes require a signed-in administrator', async () => {
  expect((await request(publicApp()).post('/api/services').send(advising)).status).toBe(401);
  expect((await request(appAs(member)).post('/api/services').send(advising)).status).toBe(403);
  const { id } = (await create()).body.data;
  expect((await request(publicApp()).patch(`/api/services/${id}`).send({ name: 'X' })).status).toBe(401);
  expect((await request(appAs(member)).patch(`/api/services/${id}`).send({ name: 'X' })).status).toBe(403);
  expect(rows()[0].name).toBe('Student Advising');
});

test('users can join the queue of a database-created service once it is opened', async () => {
  const { id } = (await create()).body.data;
  await request(appAs(admin)).patch(`/api/admin/services/${id}/queue`).send({ isOpen: true });
  const joined = await request(appAs(member)).post(`/api/services/${id}/queue/join`).send({});
  expect(joined.status).toBe(201);
  expect(joined.body.data).toMatchObject({ position: 1, estimatedWaitMinutes: 0,
    entry: { serviceId: id, priority: 'medium' } });
});

test('editing a service keeps its queue status', async () => {
  const { id } = (await create()).body.data;
  await request(appAs(admin)).patch(`/api/admin/services/${id}/queue`).send({ isOpen: true });
  const updated = await request(appAs(admin)).patch(`/api/services/${id}`).send({ name: 'Renamed' });
  expect(updated.body.data).toMatchObject({ name: 'Renamed', isOpen: true });
});

test('getService returns the API shape or SERVICE_NOT_FOUND', async () => {
  const { id } = (await create()).body.data;
  const manager = createServiceManager({ store, db });
  expect(manager.getService(id)).toMatchObject({ id, priority: 'medium', isOpen: false });
  expect(() => manager.getService('missing')).toThrow(expect.objectContaining({ code: 'SERVICE_NOT_FOUND' }));
});

test('a locked database returns 503 DATABASE_BUSY without leaking SQL', async () => {
  const locker = openDatabase({ filename: file });
  locker.exec('PRAGMA busy_timeout = 0');
  db.exec('PRAGMA busy_timeout = 0');
  locker.exec('BEGIN IMMEDIATE');
  try {
    const response = await create();
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'DATABASE_BUSY', message: 'Database is busy. Please try again.' } });
  } finally {
    locker.exec('ROLLBACK');
    locker.close();
  }
});