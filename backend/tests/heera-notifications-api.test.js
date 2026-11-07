const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase, withWriteTransaction } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { requireAuth } = require('../src/middleware/auth');
const { notFound, errorHandler } = require('../src/shared/errors');
const { createServiceRepository } = require('../src/modules/abel/serviceRepository');
const { createAppointmentRepository } = require('../src/modules/heera/appointmentRepository');
const { createAppointmentRouter } = require('../src/modules/heera/appointmentRouter');
const { createNotificationRouter } = require('../src/modules/heera/notificationRouter');
const { createNotificationService } = require('../src/modules/heera/notificationService');
const { createAuthService } = require('../src/modules/nik/auth.service');
const { createStore } = require('../src/shared/store');

// Fixed test clock: 9:00 AM America/Chicago (CST) on 2026-11-04.
const NOW = '2026-11-04T15:00:00.000Z';
const at = minutes => new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();
const USER_FIELDS = ['createdAt', 'deliveryUnavailable', 'id', 'message', 'sentAt', 'status', 'subject', 'type',
  'viewedAt'];

let clock;
let dir;
let db;
let app;
let users;
let services;
let notifications;
let outbox;
let failures;

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
const book = async (who, serviceId, startsAt) => {
  const response = await as(who, 'post', '/api/appointments').send({ serviceId, startsAt });
  await notifications.settled();
  return response;
};
const rows = () => db.prepare('SELECT * FROM notification ORDER BY rowid').all();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-heera-notify-api-'));
  db = openDatabase({ filename: path.join(dir, 'test.sqlite') });
  runMigrations(db);
  users = { ana: addUser('ana'), ben: addUser('ben'), admin: addUser('admin', 'admin') };
  services = createServiceRepository(db);
  outbox = [];
  failures = [];
  const send = async mail => {
    outbox.push(mail);
    if (failures.length) throw failures.shift();
  };
  clock = new Date(NOW);
  const now = () => clock;
  notifications = createNotificationService(db, { send, now });
  const auth = requireAuth(resolveUser);
  app = express();
  app.use(express.json());
  app.use('/api', createAppointmentRouter({ db, auth, now, notifications }));
  app.use('/api', createNotificationRouter({ auth, notifications }));
  app.use(notFound);
  app.use(errorHandler);
});

afterEach(async () => {
  await notifications.settled();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const advising = () => services.create({ name: 'Student Advising', expectedDurationMinutes: 30 });

describe('appointment notifications', () => {
  test('booking queues a notification and emails it after commit, in Central Time', async () => {
    const service = advising();
    const booked = await book('ana', service.id, '2026-11-05T16:00:00.000Z');
    expect(booked.status).toBe(201);
    expect(outbox).toEqual([expect.objectContaining({ to: 'ana@example.com',
      subject: 'Appointment booked: Student Advising',
      text: 'Your Student Advising appointment is booked for Thursday, November 5, 2026 at 10:00 AM Central Time.' })]);
    expect(rows()).toEqual([expect.objectContaining({ user_id: users.ana.id, status: 'sent', attempts: 1,
      event_key: `appointment.booked:${booked.body.data.id}`, type: 'appointment.booked' })]);
  });

  test('a failed email leaves the booking in place', async () => {
    const service = advising();
    failures.push(new Error('SMTP down'));
    const booked = await book('ana', service.id, at(60));
    expect(booked.status).toBe(201);
    expect(db.prepare('SELECT status FROM appointment WHERE id = ?').get(booked.body.data.id).status).toBe('booked');
    expect(rows()[0]).toMatchObject({ status: 'failed', last_error: 'SMTP down' });
  });

  test('a rejected booking queues nothing', async () => {
    const service = advising();
    await book('ana', service.id, at(60));
    expect((await book('ben', service.id, at(60))).status).toBe(409);
    expect(rows()).toHaveLength(1);
  });

  test('a failure while queueing the notification rolls the booking back', () => {
    const service = advising();
    const broken = { enqueueNotification: () => { throw new Error('disk full'); }, deliverAfterCommit: jest.fn() };
    const repo = createAppointmentRepository(db, { now: () => new Date(NOW), notifications: broken });
    expect(() => repo.create({ userId: users.ana.id, serviceId: service.id, startsAt: at(60) })).toThrow('disk full');
    expect(db.prepare('SELECT count(*) AS n FROM appointment').get().n).toBe(0);
    expect(broken.deliverAfterCommit).not.toHaveBeenCalled();
  });

  test('user and admin cancels notify the owner; completing does not', async () => {
    const service = advising();
    const mine = (await book('ana', service.id, '2026-11-05T16:00:00.000Z')).body.data;
    const other = (await book('ana', service.id, '2026-11-05T17:00:00.000Z')).body.data;
    const third = (await book('ana', service.id, '2026-11-05T18:00:00.000Z')).body.data;

    await as('ana', 'post', `/api/me/appointments/${mine.id}/cancel`);
    await as('admin', 'post', `/api/admin/appointments/${other.id}/cancel`);
    // Canceling again must not notify twice.
    await as('ana', 'post', `/api/me/appointments/${mine.id}/cancel`);
    clock = new Date('2026-11-05T19:00:00.000Z');
    const completed = await as('admin', 'post', `/api/admin/appointments/${third.id}/complete`);
    expect(completed.status).toBe(200);
    await notifications.settled();

    const canceled = rows().filter(row => row.type === 'appointment.canceled');
    expect(canceled.map(row => [row.user_id, row.event_key, row.message])).toEqual([
      [users.ana.id, `appointment.canceled:${mine.id}`,
        'Your Student Advising appointment for Thursday, November 5, 2026 at 10:00 AM Central Time was canceled.'],
      [users.ana.id, `appointment.canceled:${other.id}`,
        'Your Student Advising appointment for Thursday, November 5, 2026 at 11:00 AM Central Time was canceled by staff.'],
    ]);
    expect(rows()).toHaveLength(5);
    expect(outbox).toHaveLength(5);
  });
});

describe('reschedule notifications', () => {
  test('each reschedule sends its own notification; a rejected one sends none', async () => {
    const service = advising();
    const mine = (await book('ana', service.id, '2026-11-05T16:00:00.000Z')).body.data;
    await book('ben', service.id, '2026-11-05T20:00:00.000Z');

    await as('ana', 'post', `/api/me/appointments/${mine.id}/reschedule`).send({ startsAt: '2026-11-05T17:00:00.000Z' });
    await as('admin', 'post', `/api/admin/appointments/${mine.id}/reschedule`)
      .send({ startsAt: '2026-11-05T16:00:00.000Z' });
    expect((await as('ana', 'post', `/api/me/appointments/${mine.id}/reschedule`)
      .send({ startsAt: '2026-11-05T20:00:00.000Z' })).status).toBe(409);
    await notifications.settled();

    const moved = rows().filter(row => row.type === 'appointment.rescheduled');
    expect(moved.map(row => [row.user_id, row.status, row.message])).toEqual([
      [users.ana.id, 'sent', 'Your Student Advising appointment was moved from Thursday, November 5, 2026 at '
        + '10:00 AM Central Time to Thursday, November 5, 2026 at 11:00 AM Central Time.'],
      [users.ana.id, 'sent', 'Your Student Advising appointment was moved by staff from Thursday, November 5, 2026 at '
        + '11:00 AM Central Time to Thursday, November 5, 2026 at 10:00 AM Central Time.'],
    ]);
    expect(new Set(moved.map(row => row.event_key)).size).toBe(2);
    moved.forEach(row => expect(row.event_key).toMatch(new RegExp(`^appointment\\.rescheduled:${mine.id}:`)));
    expect(moved[0].subject).toBe('Appointment rescheduled: Student Advising');
  });

  test('a failed reschedule email keeps the new time', async () => {
    const mine = (await book('ana', advising().id, at(60))).body.data;
    failures.push(new Error('SMTP down'));
    const moved = await as('ana', 'post', `/api/me/appointments/${mine.id}/reschedule`).send({ startsAt: at(120) });
    await notifications.settled();
    expect(moved.status).toBe(200);
    expect(db.prepare('SELECT starts_at FROM appointment WHERE id = ?').get(mine.id).starts_at).toBe(at(120));
    expect(rows().at(-1)).toMatchObject({ type: 'appointment.rescheduled', status: 'failed' });
  });
});

describe('GET /api/me/notifications', () => {
  test('requires sign-in', async () => {
    expect((await request(app).get('/api/me/notifications')).status).toBe(401);
  });

  test('returns only my notifications, newest first, without delivery internals', async () => {
    const service = advising();
    const first = (await book('ana', service.id, at(60))).body.data;
    await book('ben', service.id, at(120));
    clock = new Date(at(1));
    await as('ana', 'post', `/api/me/appointments/${first.id}/cancel`);
    await notifications.settled();

    const response = await as('ana', 'get', '/api/me/notifications');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(response.body.data.items.map(n => n.type)).toEqual(['appointment.canceled', 'appointment.booked']);
    response.body.data.items.forEach(item => expect(Object.keys(item).sort()).toEqual(USER_FIELDS));
    expect(JSON.stringify(response.body)).not.toMatch(/eventKey|attempts|lastError|userId/);
  });

  test('pages 20 at a time and filters by status', async () => {
    const service = advising();
    for (let i = 0; i < 21; i += 1) await book('ana', service.id, at(60 * (i + 1)));
    const sized = await as('ana', 'get', '/api/me/notifications?pageSize=5');
    expect(sized.body.data).toMatchObject({ pageSize: 5, totalPages: 5 });
    expect(sized.body.data.items).toHaveLength(5);
    const second = await as('ana', 'get', '/api/me/notifications?page=2');
    expect(second.body.data).toMatchObject({ page: 2, total: 21, totalPages: 2 });
    expect(second.body.data.items).toHaveLength(1);
    expect((await as('ana', 'get', '/api/me/notifications?status=failed')).body.data.total).toBe(0);
    for (const query of ['page=0', 'status=queued', 'size=5', 'pageSize=101']) {
      expect((await as('ana', 'get', `/api/me/notifications?${query}`)).status).toBe(400);
    }
  });
});

test('a notification waiting on a configured provider is not marked unavailable', async () => {
  const { notification } = withWriteTransaction(db, tx => notifications.enqueueNotification(tx, {
    userId: users.ana.id, eventKey: 'test:pending', type: 'appointment.booked', subject: 'S', message: 'M' }));
  const { items } = (await as('ana', 'get', '/api/me/notifications')).body.data;
  expect(items).toEqual([expect.objectContaining({ id: notification.id, status: 'pending',
    deliveryUnavailable: false })]);
});

describe('POST /api/me/notifications/:id/view', () => {
  test('marks my notification viewed and hides other users\' notifications', async () => {
    await book('ana', advising().id, at(60));
    const [{ id }] = (await as('ana', 'get', '/api/me/notifications')).body.data.items;
    const theirs = await as('ben', 'post', `/api/me/notifications/${id}/view`);
    expect(theirs.status).toBe(404);
    const viewed = await as('ana', 'post', `/api/me/notifications/${id}/view`);
    expect(viewed.status).toBe(200);
    expect(viewed.body.data).toMatchObject({ id, status: 'viewed', viewedAt: NOW });
    expect(Object.keys(viewed.body.data).sort()).toEqual(USER_FIELDS);
    expect((await request(app).post(`/api/me/notifications/${id}/view`)).status).toBe(401);
  });
});

describe('admin notification routes', () => {
  test('require an admin', async () => {
    for (const [method, url] of [['get', '/api/admin/notifications'],
      ['post', `/api/admin/notifications/${randomUUID()}/retry`]]) {
      expect((await request(app)[method](url)).status).toBe(401);
      expect((await as('ana', method, url)).status).toBe(403);
    }
  });

  test('admin list shows every user\'s notifications with delivery details', async () => {
    const service = advising();
    failures.push(new Error('bounced'));
    await book('ana', service.id, at(60));
    await book('ben', service.id, at(120));
    const all = await as('admin', 'get', '/api/admin/notifications');
    expect(all.body.data.total).toBe(2);
    const failed = await as('admin', 'get', '/api/admin/notifications?status=failed');
    expect(failed.body.data.items).toEqual([expect.objectContaining({ userId: users.ana.id, status: 'failed',
      attempts: 1, lastError: 'bounced', eventKey: expect.stringMatching(/^appointment\.booked:/) })]);
  });

  test('retry resends a failed notification, at most three attempts in total', async () => {
    failures.push(new Error('one'), new Error('two'), new Error('three'));
    await book('ana', advising().id, at(60));
    const [{ id }] = (await as('admin', 'get', '/api/admin/notifications')).body.data.items;

    const second = await as('admin', 'post', `/api/admin/notifications/${id}/retry`);
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ status: 'failed', attempts: 2, lastError: 'two' });
    expect((await as('admin', 'post', `/api/admin/notifications/${id}/retry`)).body.data.attempts).toBe(3);
    const limit = await as('admin', 'post', `/api/admin/notifications/${id}/retry`);
    expect(limit.status).toBe(409);
    expect(limit.body.error.code).toBe('RETRY_LIMIT_REACHED');
    expect(outbox).toHaveLength(3);
  });

  test('retry succeeds after a failure, and refuses notifications that did not fail', async () => {
    failures.push(new Error('down'));
    await book('ana', advising().id, at(60));
    await book('ben', advising().id, at(60));
    const items = (await as('admin', 'get', '/api/admin/notifications')).body.data.items;
    const failed = items.find(item => item.status === 'failed');
    const sent = items.find(item => item.status === 'sent');
    expect((await as('admin', 'post', `/api/admin/notifications/${failed.id}/retry`)).body.data)
      .toMatchObject({ status: 'sent', attempts: 2, lastError: null, sentAt: NOW });
    const refused = await as('admin', 'post', `/api/admin/notifications/${sent.id}/retry`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATUS');
    expect((await as('admin', 'post', `/api/admin/notifications/${randomUUID()}/retry`)).status).toBe(404);
  });
});

test('booked appointments, sent notifications and viewed status survive a backend restart', async () => {
  const service = advising();
  const booked = (await book('ana', service.id, at(60))).body.data;
  const [{ id }] = (await as('ana', 'get', '/api/me/notifications')).body.data.items;
  await as('ana', 'post', `/api/me/notifications/${id}/view`);

  db.close();
  db = openDatabase({ filename: path.join(dir, 'test.sqlite') });
  expect(runMigrations(db)).toEqual([]);
  const restarted = createApp({ db, resolveUser });
  try {
    const appointments = await request(restarted).get('/api/me/appointments').set('x-test-user', 'ana');
    expect(appointments.body.data).toEqual([booked]);
    const history = await request(restarted).get('/api/me/notifications').set('x-test-user', 'ana');
    expect(history.body.data.items).toEqual([expect.objectContaining({ id, status: 'viewed', viewedAt: NOW,
      sentAt: NOW, type: 'appointment.booked' })]);
  } finally {
    restarted.locals.stopSubscribers();
  }
});

describe('welcome notification', () => {
  const register = (app, email) => request(app).post('/api/auth/register')
    .send({ name: 'Cy Lee', email, password: 'password123' });
  const welcomes = () => db.prepare("SELECT * FROM notification WHERE type = 'user.welcome'").all();

  test('registering stores one welcome with the new account, and it shows in history', async () => {
    const full = createApp({ db });
    try {
      const { body } = await register(full, 'cy@example.com');
      expect(welcomes()).toEqual([expect.objectContaining({ user_id: body.data.user.id, status: 'pending',
        subject: 'Welcome to QueueSmart', message: 'Welcome to QueueSmart, Cy Lee! Your account is ready.',
        event_key: expect.stringMatching(new RegExp(`^user\\.welcome:${body.data.user.id}:`)) })]);
      const history = await request(full).get('/api/me/notifications')
        .set('Authorization', `Bearer ${body.data.token}`);
      expect(history.body.data.items).toEqual([expect.objectContaining({ type: 'user.welcome',
        deliveryUnavailable: true })]);
    } finally {
      full.locals.stopSubscribers();
    }
  });

  test('a duplicate registration leaves no second account or welcome', async () => {
    const full = createApp({ db });
    try {
      await register(full, 'cy@example.com');
      expect((await register(full, 'CY@example.com')).status).toBe(409);
      expect(welcomes()).toHaveLength(1);
    } finally {
      full.locals.stopSubscribers();
    }
  });

  test('the welcome is emailed through the given service after the account commits', async () => {
    const auth = createAuthService({ store: createStore(), db, notificationService: notifications });
    const user = await auth.register({ name: 'Cy Lee', email: 'cy@example.com', password: 'password123' });
    await notifications.settled();
    expect(outbox).toEqual([expect.objectContaining({ to: 'cy@example.com', subject: 'Welcome to QueueSmart' })]);
    expect(welcomes()).toEqual([expect.objectContaining({ user_id: user.id, status: 'sent' })]);
  });

  test('a failure saving the welcome also cancels the account', async () => {
    const broken = { enqueueNotification: () => { throw new Error('disk full'); }, deliverAfterCommit: jest.fn() };
    const auth = createAuthService({ store: createStore(), db, notificationService: broken });
    await expect(auth.register({ name: 'Cy Lee', email: 'cy@example.com', password: 'password123' }))
      .rejects.toThrow('disk full');
    expect(db.prepare("SELECT count(*) AS n FROM user_credentials WHERE email = 'cy@example.com'").get().n).toBe(0);
    expect(broken.deliverAfterCommit).not.toHaveBeenCalled();
  });

  test('the bootstrap administrator gets no welcome', async () => {
    const auth = createAuthService({ store: createStore(), db, notificationService: notifications });
    await auth.registerAdmin({ name: 'Ad Min', email: 'boss@example.com', password: 'password123' });
    expect(welcomes()).toEqual([]);
  });
});

test('the admin dashboard reports appointment counts by status', async () => {
  const full = createApp({ db, resolveUser });
  try {
    const service = advising();
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await request(full).post('/api/appointments').set('x-test-user', 'ana').send({ serviceId: service.id, startsAt });
    const dashboard = await request(full).get('/api/admin/dashboard').set('x-test-user', 'admin');
    expect(dashboard.body.data.appointmentCounts).toEqual({ booked: 1, canceled: 0, completed: 0 });
  } finally {
    full.locals.stopSubscribers();
  }
});

describe('app wiring', () => {
  test('createApp books, notifies and lists through one notification service', async () => {
    const full = createApp({ db, resolveUser });
    try {
      const service = advising();
      const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const created = await request(full).post('/api/appointments').set('x-test-user', 'ana')
        .send({ serviceId: service.id, startsAt });
      expect(created.status).toBe(201);
      // No email provider is configured, so the notification must not claim it was sent.
      const mine = (await request(full).get('/api/me/notifications').set('x-test-user', 'ana')).body.data;
      expect(mine.items).toEqual([expect.objectContaining({ type: 'appointment.booked', status: 'pending',
        sentAt: null, deliveryUnavailable: true })]);
      const all = await request(full).get('/api/admin/notifications').set('x-test-user', 'admin');
      expect(all.body.data.items).toEqual([expect.objectContaining({ status: 'pending', attempts: 0,
        deliveryUnavailable: true })]);
      const viewed = await request(full).post(`/api/me/notifications/${mine.items[0].id}/view`)
        .set('x-test-user', 'ana');
      expect(viewed.status).toBe(409);
      expect(viewed.body.error.code).toBe('INVALID_STATUS');
    } finally {
      full.locals.stopSubscribers();
    }
  });
});
