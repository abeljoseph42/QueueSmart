const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { createServiceRepository } = require('../src/modules/abel/serviceRepository');
const {
  APPOINTMENT_STATUSES, MAX_DAYS_AHEAD, createAppointmentRepository,
} = require('../src/modules/heera/appointmentRepository');

const MIGRATIONS = path.join(__dirname, '../src/database/migrations');
const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Fixed test clock: 9:00 AM America/Chicago (CST) on 2026-11-04.
const NOW = '2026-11-04T15:00:00.000Z';
const at = (minutesFromNow, base = NOW) => new Date(Date.parse(base) + minutesFromNow * 60 * 1000).toISOString();

let dir;
let file;
let db;
let clock;
let repo;
let services;

const addUser = (email = `${randomUUID()}@example.com`) => {
  const id = randomUUID();
  db.prepare('INSERT INTO user_credentials (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, 'x');
  return id;
};
const addService = (overrides = {}) =>
  services.create({ name: 'Student Advising', expectedDurationMinutes: 30, ...overrides });

const expectError = (fn, status, code, message) => {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(caught).toMatchObject({ status, code, ...(message ? { message } : {}) });
  return caught;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-heera-'));
  file = path.join(dir, 'test.sqlite');
  db = openDatabase({ filename: file });
  runMigrations(db);
  clock = new Date(NOW);
  repo = createAppointmentRepository(db, { now: () => clock });
  services = createServiceRepository(db);
});

afterEach(() => {
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('006_appointments migration', () => {
  test('applies after the earlier migrations', () => {
    const names = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(row => row.name);
    expect(names).toContain('006_appointments.sql');
    expect(names.at(-1)).toBe('006_appointments.sql');
  });

  test('applies on top of a database that already has 001-004', () => {
    const staged = path.join(dir, 'migrations');
    fs.mkdirSync(staged);
    const copy = name => fs.copyFileSync(path.join(MIGRATIONS, name), path.join(staged, name));
    fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql') && name < '006').forEach(copy);
    const old = openDatabase({ filename: path.join(dir, 'old.sqlite') });
    try {
      runMigrations(old, staged);
      copy('006_appointments.sql');
      expect(runMigrations(old, staged)).toEqual(['006_appointments.sql']);
      expect(old.prepare('SELECT count(*) AS n FROM appointment').get().n).toBe(0);
    } finally {
      old.close();
    }
  });

  test('enforces statuses, UTC timestamps, foreign keys, and the live-slot index', () => {
    const userId = addUser();
    const service = addService();
    const insert = (overrides = {}) => {
      const row = { id: randomUUID(), user_id: userId, service_id: service.id, starts_at: at(60),
        ends_at: at(90), status: 'booked', created_at: NOW, updated_at: NOW, ...overrides };
      db.prepare(`INSERT INTO appointment (id, user_id, service_id, starts_at, ends_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(row));
      return row;
    };
    expect(() => insert({ status: 'pending' })).toThrow(/CHECK/);
    expect(() => insert({ starts_at: '2026-11-04 16:00:00' })).toThrow(/CHECK/);
    expect(() => insert({ ends_at: at(60) })).toThrow(/CHECK/);
    expect(() => insert({ user_id: randomUUID() })).toThrow(/FOREIGN KEY/);
    expect(() => insert({ service_id: randomUUID() })).toThrow(/FOREIGN KEY/);
    const first = insert();
    expect(() => insert({ user_id: addUser() })).toThrow(/UNIQUE/);
    db.prepare("UPDATE appointment SET status = 'canceled' WHERE id = ?").run(first.id);
    expect(() => insert({ user_id: addUser() })).not.toThrow();
  });
});

describe('create', () => {
  test('books a slot, stores UTC, and sizes it from the service duration', () => {
    const userId = addUser();
    const service = addService({ expectedDurationMinutes: 45 });
    // 10:00 AM in Chicago, sent with its offset.
    const appointment = repo.create({ userId, serviceId: service.id, startsAt: '2026-11-05T10:00:00-06:00' });
    expect(appointment).toEqual({
      id: expect.any(String), userId, serviceId: service.id,
      startsAt: '2026-11-05T16:00:00.000Z', endsAt: '2026-11-05T16:45:00.000Z',
      status: 'booked', createdAt: NOW, updatedAt: NOW,
    });
    expect(appointment.id).toHaveLength(36);
    expect(repo.findById(appointment.id)).toEqual(appointment);
  });

  test('keeps the booked length when the service duration changes later', () => {
    const userId = addUser();
    const service = addService({ expectedDurationMinutes: 30 });
    const booked = repo.create({ userId, serviceId: service.id, startsAt: at(60) });
    services.update(service.id, { expectedDurationMinutes: 90 });
    expect(repo.getAppointment(booked.id).endsAt).toBe(at(90));
  });

  test('rejects invalid input', () => {
    const userId = addUser();
    const service = addService();
    const valid = { userId, serviceId: service.id, startsAt: at(60) };
    for (const input of [{}, { ...valid, userId: 'u1' }, { ...valid, serviceId: 42 },
      { ...valid, startsAt: 'tomorrow' }, { ...valid, startsAt: '2026-11-05T10:00:00' }, { ...valid, extra: true }]) {
      const error = expectError(() => repo.create(input), 400, 'VALIDATION_ERROR');
      expect(error.details.length).toBeGreaterThan(0);
    }
    expect(repo.listByService(service.id)).toEqual([]);
  });

  test('requires a start in the future and at most 365 days ahead', () => {
    const userId = addUser();
    const service = addService();
    const book = startsAt => () => repo.create({ userId, serviceId: service.id, startsAt });
    for (const startsAt of [NOW, at(-1)]) {
      const error = expectError(book(startsAt), 400, 'VALIDATION_ERROR');
      expect(error.details).toEqual([{ path: 'startsAt', message: 'Appointment must be in the future.' }]);
    }
    const limit = at(MAX_DAYS_AHEAD * 24 * 60);
    const error = expectError(book(at(1, limit)), 400, 'VALIDATION_ERROR');
    expect(error.details).toEqual([{ path: 'startsAt', message: 'Appointment must be at most 365 days ahead.' }]);
    expect(repo.create({ userId, serviceId: service.id, startsAt: limit }).startsAt).toBe(limit);
    expect(repo.create({ userId, serviceId: addService().id, startsAt: at(1) }).startsAt).toBe(at(1));
  });

  test('uses the injected clock for the time window', () => {
    const userId = addUser();
    const service = addService();
    clock = new Date(at(24 * 60));
    expectError(() => repo.create({ userId, serviceId: service.id, startsAt: at(60) }), 400, 'VALIDATION_ERROR');
    expect(repo.create({ userId, serviceId: service.id, startsAt: at(25 * 60) }).createdAt).toBe(at(24 * 60));
  });

  test('defaults to the real clock', () => {
    const real = createAppointmentRepository(db);
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(real.create({ userId: addUser(), serviceId: addService().id, startsAt }).createdAt).toMatch(UTC_MS);
  });

  test('404s for unknown users and services', () => {
    const service = addService();
    expectError(() => repo.create({ userId: randomUUID(), serviceId: service.id, startsAt: at(60) }),
      404, 'NOT_FOUND', 'User not found.');
    expectError(() => repo.create({ userId: addUser(), serviceId: randomUUID(), startsAt: at(60) }),
      404, 'NOT_FOUND', 'Service not found.');
  });

  test('blocks booking when the service is inactive', () => {
    const service = addService({ isActive: false });
    expectError(() => repo.create({ userId: addUser(), serviceId: service.id, startsAt: at(60) }),
      409, 'SERVICE_INACTIVE');
    expect(repo.listByService(service.id)).toEqual([]);
  });

  test('allows one live appointment per service time slot', () => {
    const service = addService({ expectedDurationMinutes: 30 });
    repo.create({ userId: addUser(), serviceId: service.id, startsAt: at(60) });
    const message = 'This time slot is already booked for the service.';
    for (const startsAt of [at(60), at(45), at(75), at(89)]) {
      expectError(() => repo.create({ userId: addUser(), serviceId: service.id, startsAt }),
        409, 'SLOT_CONFLICT', message);
    }
    expect(repo.create({ userId: addUser(), serviceId: service.id, startsAt: at(30) }).endsAt).toBe(at(60));
    expect(repo.create({ userId: addUser(), serviceId: service.id, startsAt: at(90) }).startsAt).toBe(at(90));
    expect(repo.create({ userId: addUser(), serviceId: addService().id, startsAt: at(60) }).status).toBe('booked');
  });

  test('stops a user from holding overlapping appointments but allows back-to-back ones', () => {
    const userId = addUser();
    const [a, b, c] = [addService(), addService(), addService()];
    repo.create({ userId, serviceId: a.id, startsAt: at(60) });
    expectError(() => repo.create({ userId, serviceId: b.id, startsAt: at(75) }),
      409, 'SLOT_CONFLICT', 'You already have an appointment at this time.');
    expect(repo.create({ userId, serviceId: b.id, startsAt: at(90) }).startsAt).toBe(at(90));
    expect(repo.create({ userId, serviceId: c.id, startsAt: at(30) }).endsAt).toBe(at(60));
    expect(repo.listByUser(userId)).toHaveLength(3);
  });

  test('a canceled appointment frees its slot; a completed one keeps it', () => {
    const service = addService();
    const userId = addUser();
    const first = repo.create({ userId, serviceId: service.id, startsAt: at(60) });
    repo.cancel(first.id);
    const second = repo.create({ userId, serviceId: service.id, startsAt: at(60) });
    repo.complete(second.id);
    expectError(() => repo.create({ userId: addUser(), serviceId: service.id, startsAt: at(60) }),
      409, 'SLOT_CONFLICT');
  });

  test('concurrent bookings of one slot from separate connections leave exactly one booked', async () => {
    const service = addService();
    const userIds = Array.from({ length: 6 }, () => addUser());
    const gate = new SharedArrayBuffer(8);
    const flag = new Int32Array(gate);
    const startsAt = at(120);
    const workers = userIds.map(userId => new Worker(path.join(__dirname, 'heera-appointments.worker.js'),
      { workerData: { file, now: NOW, gate, input: { userId, serviceId: service.id, startsAt } } }));
    const results = workers.map(worker => new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    }));
    while (Atomics.load(flag, 1) < workers.length) await new Promise(resolve => setTimeout(resolve, 5));
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    const outcomes = await Promise.all(results);
    await Promise.all(workers.map(worker => worker.terminate()));

    expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter(outcome => !outcome.ok))
      .toEqual(Array(5).fill({ ok: false, status: 409, code: 'SLOT_CONFLICT' }));
    expect(repo.listByService(service.id)).toEqual([outcomes.find(outcome => outcome.ok).appointment]);
  }, 20000);
});

describe('reads', () => {
  test('getAppointment 404s and findById returns null for unknown ids', () => {
    expect(repo.findById(randomUUID())).toBeNull();
    expectError(() => repo.getAppointment(randomUUID()), 404, 'NOT_FOUND', 'Appointment not found.');
  });

  test('lists by user and by service in start order, optionally by status', () => {
    const ana = addUser();
    const ben = addUser();
    const [s1, s2] = [addService(), addService()];
    const later = repo.create({ userId: ana, serviceId: s1.id, startsAt: at(300) });
    const sooner = repo.create({ userId: ana, serviceId: s2.id, startsAt: at(60) });
    const bens = repo.create({ userId: ben, serviceId: s1.id, startsAt: at(60) });
    repo.cancel(later.id);

    expect(repo.listByUser(ana).map(a => a.id)).toEqual([sooner.id, later.id]);
    expect(repo.listByUser(ana, { status: 'booked' }).map(a => a.id)).toEqual([sooner.id]);
    expect(repo.listByUser(ana, { status: 'canceled' }).map(a => a.id)).toEqual([later.id]);
    expect(repo.listByUser(addUser())).toEqual([]);
    expect(repo.listByService(s1.id).map(a => a.id)).toEqual([bens.id, later.id]);
    expect(repo.listByService(s1.id, { status: 'booked' }).map(a => a.id)).toEqual([bens.id]);
    expectError(() => repo.listByUser(ana, { status: 'pending' }), 400, 'VALIDATION_ERROR');
    expectError(() => repo.listByService(s1.id, { from: NOW }), 400, 'VALIDATION_ERROR');
  });
});

describe('status changes', () => {
  test('exports the three statuses', () => {
    expect(APPOINTMENT_STATUSES).toEqual(['booked', 'canceled', 'completed']);
  });

  test('cancel and complete move booked appointments and stamp updatedAt', () => {
    const userId = addUser();
    const first = repo.create({ userId, serviceId: addService().id, startsAt: at(60) });
    const second = repo.create({ userId, serviceId: addService().id, startsAt: at(120) });
    clock = new Date(at(5));
    expect(repo.cancel(first.id, { userId })).toEqual({ ...first, status: 'canceled', updatedAt: at(5) });
    expect(repo.complete(second.id)).toEqual({ ...second, status: 'completed', updatedAt: at(5) });
  });

  test('only booked appointments can change status', () => {
    const userId = addUser();
    const canceled = repo.create({ userId, serviceId: addService().id, startsAt: at(60) });
    const completed = repo.create({ userId, serviceId: addService().id, startsAt: at(120) });
    repo.cancel(canceled.id);
    repo.complete(completed.id);
    expectError(() => repo.cancel(canceled.id), 409, 'INVALID_STATUS',
      'Only booked appointments can be canceled; this one is canceled.');
    expectError(() => repo.complete(canceled.id), 409, 'INVALID_STATUS');
    expectError(() => repo.cancel(completed.id), 409, 'INVALID_STATUS');
    expect(repo.getAppointment(completed.id).status).toBe('completed');
  });

  test("a user cannot cancel someone else's appointment, and unknown ids 404", () => {
    const owner = addUser();
    const booked = repo.create({ userId: owner, serviceId: addService().id, startsAt: at(60) });
    expectError(() => repo.cancel(booked.id, { userId: addUser() }), 404, 'NOT_FOUND');
    expectError(() => repo.cancel(randomUUID()), 404, 'NOT_FOUND');
    expectError(() => repo.complete(randomUUID()), 404, 'NOT_FOUND');
    expect(repo.getAppointment(booked.id).status).toBe('booked');
  });
});
