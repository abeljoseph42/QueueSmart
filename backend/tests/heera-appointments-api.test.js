const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { requireAuth } = require('../src/middleware/auth');
const { notFound, errorHandler } = require('../src/shared/errors');
const { createServiceRepository } = require('../src/modules/abel/serviceRepository');
const { createAppointmentRouter } = require('../src/modules/heera/appointmentRouter');

// Fixed test clock: 9:00 AM America/Chicago (CST) on 2026-11-04.
const NOW = '2026-11-04T15:00:00.000Z';
const at = minutes => new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();

let clock;
let dir;
let db;
let app;
let users;
let services;

const addUser = (name, role = 'user') => {
  const id = randomUUID();
  const email = `${name}@example.com`;
  db.prepare('INSERT INTO user_credentials (id, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(id, email, 'x', role === 'admin' ? 'Administrator' : 'User');
  return { id, name, email, role };
};
// Test-only identity: x-test-user names the signed-in user; no header is signed out.
const resolveUser = async req => users[req.get('x-test-user')] ?? null;
const as = (who, method, url) => request(app)[method](url).set('x-test-user', who);
const book = (who, body) => as(who, 'post', '/api/appointments').send(body);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-heera-api-'));
  db = openDatabase({ filename: path.join(dir, 'test.sqlite') });
  runMigrations(db);
  clock = new Date(NOW);
  users = { ana: addUser('ana'), ben: addUser('ben'), admin: addUser('admin', 'admin') };
  services = createServiceRepository(db);
  app = express();
  app.use(express.json());
  app.use('/api', createAppointmentRouter({ db, auth: requireAuth(resolveUser), now: () => clock }));
  app.use(notFound);
  app.use(errorHandler);
});

afterEach(() => {
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const advising = () => services.create({ name: 'Student Advising', expectedDurationMinutes: 30 });

describe('POST /api/appointments', () => {
  test('requires a signed-in user', async () => {
    const response = await request(app).post('/api/appointments').send({ serviceId: advising().id, startsAt: at(60) });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('books for the signed-in user and returns 201', async () => {
    const service = advising();
    const response = await book('ana', { serviceId: service.id, startsAt: '2026-11-05T10:00:00-06:00' });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ userId: users.ana.id, serviceId: service.id,
      startsAt: '2026-11-05T16:00:00.000Z', endsAt: '2026-11-05T16:30:00.000Z', status: 'booked' });
  });

  test('rejects bodies that pick a user or are malformed', async () => {
    const service = advising();
    for (const body of [{}, { serviceId: service.id }, { serviceId: service.id, startsAt: at(60), userId: users.ben.id },
      { serviceId: service.id, startsAt: 'soon' }]) {
      const response = await book('ana', body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('maps repository rules to HTTP errors', async () => {
    const service = advising();
    expect((await book('ana', { serviceId: service.id, startsAt: at(60) })).status).toBe(201);

    const taken = await book('ben', { serviceId: service.id, startsAt: at(75) });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toEqual({ code: 'SLOT_CONFLICT',
      message: 'This time slot is already booked for the service.' });

    const past = await book('ben', { serviceId: service.id, startsAt: at(-5) });
    expect(past.status).toBe(400);
    expect(past.body.error.details).toEqual([{ path: 'startsAt', message: 'Appointment must be in the future.' }]);

    const inactive = services.create({ name: 'Closed Desk', expectedDurationMinutes: 10, isActive: false });
    expect((await book('ben', { serviceId: inactive.id, startsAt: at(60) })).body.error.code).toBe('SERVICE_INACTIVE');
    expect((await book('ben', { serviceId: randomUUID(), startsAt: at(60) })).status).toBe(404);
  });
});

describe('user appointments', () => {
  test('GET /api/me/appointments lists only my appointments, optionally by status', async () => {
    const service = advising();
    const first = (await book('ana', { serviceId: service.id, startsAt: at(120) })).body.data;
    const second = (await book('ana', { serviceId: service.id, startsAt: at(60) })).body.data;
    await book('ben', { serviceId: service.id, startsAt: at(180) });
    await as('ana', 'post', `/api/me/appointments/${first.id}/cancel`);

    const all = await as('ana', 'get', '/api/me/appointments');
    expect(all.status).toBe(200);
    expect(all.body.data.map(a => a.id)).toEqual([second.id, first.id]);
    const booked = await as('ana', 'get', '/api/me/appointments?status=booked');
    expect(booked.body.data.map(a => a.id)).toEqual([second.id]);
    expect((await as('ana', 'get', '/api/me/appointments?status=pending')).status).toBe(400);
    expect((await request(app).get('/api/me/appointments')).status).toBe(401);
  });

  test('a user cancels their own appointment but not someone else\'s', async () => {
    const service = advising();
    const mine = (await book('ana', { serviceId: service.id, startsAt: at(60) })).body.data;

    const theirs = await as('ben', 'post', `/api/me/appointments/${mine.id}/cancel`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe('NOT_FOUND');

    const canceled = await as('ana', 'post', `/api/me/appointments/${mine.id}/cancel`);
    expect(canceled.status).toBe(200);
    expect(canceled.body.data).toMatchObject({ id: mine.id, status: 'canceled' });

    const again = await as('ana', 'post', `/api/me/appointments/${mine.id}/cancel`);
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(canceled.body.data);
    expect((await as('ana', 'post', '/api/me/appointments/nope/cancel')).status).toBe(404);
  });
});

describe('POST /api/me/appointments/:id/reschedule', () => {
  test('moves my own appointment but not someone else\'s', async () => {
    const service = advising();
    const mine = (await book('ana', { serviceId: service.id, startsAt: at(60) })).body.data;
    const path = `/api/me/appointments/${mine.id}/reschedule`;

    expect((await request(app).post(path).send({ startsAt: at(120) })).status).toBe(401);
    const theirs = await as('ben', 'post', path).send({ startsAt: at(120) });
    expect(theirs.status).toBe(404);

    const moved = await as('ana', 'post', path).send({ startsAt: '2026-11-05T10:00:00-06:00' });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ id: mine.id, status: 'booked',
      startsAt: '2026-11-05T16:00:00.000Z', endsAt: '2026-11-05T16:30:00.000Z' });
  });

  test('maps validation and slot rules to HTTP errors', async () => {
    const service = advising();
    const mine = (await book('ana', { serviceId: service.id, startsAt: at(60) })).body.data;
    await book('ben', { serviceId: service.id, startsAt: at(180) });
    const path = `/api/me/appointments/${mine.id}/reschedule`;
    for (const body of [{}, { startsAt: at(120), serviceId: service.id }, { startsAt: at(-5) }]) {
      expect((await as('ana', 'post', path).send(body)).status).toBe(400);
    }
    const taken = await as('ana', 'post', path).send({ startsAt: at(190) });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_CONFLICT');
  });
});

describe('admin appointments', () => {
  const adminRoutes = id => [['get', `/api/admin/services/${id}/appointments`],
    ['post', `/api/admin/appointments/${id}/cancel`], ['post', `/api/admin/appointments/${id}/complete`],
    ['post', `/api/admin/appointments/${id}/reschedule`]];

  test('admin routes require an admin', async () => {
    for (const [method, url] of adminRoutes(randomUUID())) {
      expect((await request(app)[method](url)).status).toBe(401);
      const forbidden = await as('ana', method, url);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.error.code).toBe('FORBIDDEN');
    }
  });

  test('lists a service\'s appointments, optionally by status, and 404s unknown services', async () => {
    const service = advising();
    const a = (await book('ana', { serviceId: service.id, startsAt: at(90) })).body.data;
    const b = (await book('ben', { serviceId: service.id, startsAt: at(30) })).body.data;
    await as('admin', 'post', `/api/admin/appointments/${a.id}/cancel`);

    const all = await as('admin', 'get', `/api/admin/services/${service.id}/appointments`);
    expect(all.status).toBe(200);
    expect(all.body.data.map(x => x.id)).toEqual([b.id, a.id]);
    const canceled = await as('admin', 'get', `/api/admin/services/${service.id}/appointments?status=canceled`);
    expect(canceled.body.data.map(x => x.id)).toEqual([a.id]);

    const missing = await as('admin', 'get', `/api/admin/services/${randomUUID()}/appointments`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({ code: 'NOT_FOUND', message: 'Service not found.' });
    expect((await as('admin', 'get', `/api/admin/services/${service.id}/appointments?from=x`)).status).toBe(400);
  });

  test('admin reschedules any booked appointment', async () => {
    const service = advising();
    const a = (await book('ana', { serviceId: service.id, startsAt: at(30) })).body.data;
    const moved = await as('admin', 'post', `/api/admin/appointments/${a.id}/reschedule`).send({ startsAt: at(90) });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ id: a.id, userId: users.ana.id, startsAt: at(90), endsAt: at(120) });
    expect((await as('admin', 'post', `/api/admin/appointments/${a.id}/reschedule`).send({})).status).toBe(400);
    expect((await as('admin', 'post', `/api/admin/appointments/${randomUUID()}/reschedule`)
      .send({ startsAt: at(300) })).status).toBe(404);
  });

  test('admin cancels or completes any booked appointment', async () => {
    const service = advising();
    const a = (await book('ana', { serviceId: service.id, startsAt: at(30) })).body.data;
    const b = (await book('ben', { serviceId: service.id, startsAt: at(60) })).body.data;

    const early = await as('admin', 'post', `/api/admin/appointments/${a.id}/complete`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('APPOINTMENT_NOT_ENDED');
    const canceled = await as('admin', 'post', `/api/admin/appointments/${b.id}/cancel`);
    expect(canceled.body.data).toMatchObject({ id: b.id, status: 'canceled' });
    clock = new Date(at(60));
    const completed = await as('admin', 'post', `/api/admin/appointments/${a.id}/complete`);
    expect(completed.status).toBe(200);
    expect(completed.body.data).toMatchObject({ id: a.id, status: 'completed' });

    expect((await as('admin', 'post', `/api/admin/appointments/${a.id}/cancel`)).body.error.code).toBe('INVALID_STATUS');
    expect((await as('admin', 'post', `/api/admin/appointments/${randomUUID()}/complete`)).status).toBe(404);
  });
});

describe('app wiring', () => {
  test('createApp serves appointment routes when it has a database, using the real clock', async () => {
    const full = createApp({ db, resolveUser });
    try {
      const service = advising();
      const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const created = await request(full).post('/api/appointments').set('x-test-user', 'ana')
        .send({ serviceId: service.id, startsAt });
      expect(created.status).toBe(201);
      const mine = await request(full).get('/api/me/appointments').set('x-test-user', 'ana');
      expect(mine.body.data.map(a => a.id)).toEqual([created.body.data.id]);
      const listed = await request(full).get(`/api/admin/services/${service.id}/appointments`).set('x-test-user', 'admin');
      expect(listed.status).toBe(200);
    } finally {
      full.locals.stopSubscribers();
    }
  });

  test('createApp without a database has no appointment routes', async () => {
    const memory = createApp({ resolveUser });
    try {
      const response = await request(memory).get('/api/me/appointments').set('x-test-user', 'ana');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    } finally {
      memory.locals.stopSubscribers();
    }
  });
});
