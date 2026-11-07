const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createAppointmentRepository } = require('../src/modules/heera/appointmentRepository');

const person = (name, role = 'user') => ({ id: randomUUID(), name, email: `${name.toLowerCase()}@example.com`, role });
const users = { admin: person('Admin', 'admin'), ana: person('Ana'), ben: person('Ben'), cy: person('Cy') };

let dir;
let db;
let app;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-admin-stats-'));
  db = openDatabase({ filename: path.join(dir, 'test.sqlite') });
  runMigrations(db);
  Object.values(users).forEach(user => db.prepare(`INSERT INTO user_credentials (id, email, password_hash, role)
    VALUES (?, ?, 'test-hash', ?)`).run(user.id, user.email, user.role === 'admin' ? 'Administrator' : 'User'));
  app = createApp({ store: createStore(), db, resolveUser: async req => users[req.get('x-test-user')] ?? null });
});

afterEach(() => {
  app.locals.stopSubscribers();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);

test('the admin dashboard reports entry counts and appointment counts by status from the database', async () => {
  const service = (await as('admin', 'post', '/api/services').send({ name: 'Student Advising',
    description: 'Course planning help', expectedDurationMinutes: 30, priority: 'medium' })).body.data;
  await as('admin', 'patch', `/api/admin/services/${service.id}/queue`).send({ isOpen: true });
  for (const who of ['ana', 'ben', 'cy']) await as(who, 'post', `/api/services/${service.id}/queue/join`).send({});
  await as('admin', 'post', `/api/admin/services/${service.id}/queue/serve-next`);
  await as('ben', 'delete', `/api/services/${service.id}/queue/me`);

  let clock = new Date('2026-11-01T12:00:00.000Z');
  const appointments = createAppointmentRepository(db, { now: () => clock });
  const at = hour => `2026-11-02T${String(hour).padStart(2, '0')}:00:00.000Z`;
  appointments.create({ userId: users.ana.id, serviceId: service.id, startsAt: at(15) });
  const canceled = appointments.create({ userId: users.ben.id, serviceId: service.id, startsAt: at(16) });
  const done = appointments.create({ userId: users.cy.id, serviceId: service.id, startsAt: at(17) });
  appointments.cancel(canceled.id);
  clock = new Date('2026-11-03T12:00:00.000Z');
  appointments.complete(done.id);

  const res = await as('admin', 'get', '/api/admin/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.data).toEqual({ serviceCount: 1, activeServiceCount: 1, openQueueCount: 1, closedQueueCount: 0,
    openServiceCount: 1, waitingCount: 1, servedCount: 1, canceledCount: 1,
    appointmentCounts: { booked: 1, canceled: 1, completed: 1 } });
});

test('appointment counts start at zero for every status', () => {
  expect(createAppointmentRepository(db).countByStatus()).toEqual({ booked: 0, canceled: 0, completed: 0 });
});
