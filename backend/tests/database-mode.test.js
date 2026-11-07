const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');

const admin = { id: randomUUID(), name: 'Admin', email: 'admin@example.com', role: 'admin' };
const ana = { id: randomUUID(), name: 'Ana', email: 'ana@example.com', role: 'user' };

let dir;
let db;
let store;
let app;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-db-mode-'));
  db = openDatabase({ filename: path.join(dir, 'test.sqlite') });
  runMigrations(db);
  for (const user of [admin, ana]) {
    db.prepare(`INSERT INTO user_credentials (id, email, password_hash, role) VALUES (?, ?, 'test-hash', ?)`)
      .run(user.id, user.email, user.role === 'admin' ? 'Administrator' : 'User');
  }
  store = createStore();
  const users = { admin, ana };
  app = createApp({ store, db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
});

afterEach(() => {
  app.locals.stopSubscribers();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);

test('with a database, queue notifications and history live only in SQLite', async () => {
  const service = (await as('admin', 'post', '/api/services').send({ name: 'Student Advising',
    description: 'Course planning help', expectedDurationMinutes: 15, priority: 'medium' })).body.data;
  await as('admin', 'patch', `/api/admin/services/${service.id}/queue`).send({ isOpen: true });
  await as('ana', 'post', `/api/services/${service.id}/queue/join`).send({});
  await as('admin', 'post', `/api/admin/services/${service.id}/queue/serve-next`);

  expect(store.notifications.size).toBe(0);
  expect(store.history.size).toBe(0);
  expect((await as('ana', 'get', '/api/me/dashboard')).body.data.notifications).toEqual([]);
  expect((await as('ana', 'get', '/api/me/history')).status).toBe(404);
  expect((await as('ana', 'get', '/api/me/queue-history')).body.data.total).toBe(1);
  const types = (await as('ana', 'get', '/api/me/notifications')).body.data.items.map(item => item.type);
  // Joined and almost ready can share a timestamp, so only the set is fixed.
    expect([...types].sort()).toEqual(['queue.joined', 'queue.near', 'queue.served']);
});

test('admins see waiting users\' names, while users only ever see their own entry', async () => {
  db.prepare("INSERT INTO user_profile (email, full_name) VALUES (?, 'Ana Lopez')").run(ana.email);
  const service = (await as('admin', 'post', '/api/services').send({ name: 'Student Advising',
    description: 'Course planning help', expectedDurationMinutes: 15, priority: 'medium' })).body.data;
  await as('admin', 'patch', `/api/admin/services/${service.id}/queue`).send({ isOpen: true });
  await as('ana', 'post', `/api/services/${service.id}/queue/join`).send({});
  await as('admin', 'post', `/api/services/${service.id}/queue/join`).send({});

  const queue = (await as('admin', 'get', `/api/admin/services/${service.id}/queue`)).body.data;
  expect(queue.map(item => [item.entry.userId, item.userName])).toEqual([[ana.id, 'Ana Lopez'], [admin.id, null]]);
  const mine = (await as('ana', 'get', `/api/services/${service.id}/queue/me`)).body.data;
  expect(mine).not.toHaveProperty('userName');
  expect((await as('ana', 'get', `/api/admin/services/${service.id}/queue`)).status).toBe(403);
});
