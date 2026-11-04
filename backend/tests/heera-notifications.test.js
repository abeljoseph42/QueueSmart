const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase, withWriteTransaction } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const {
  NOTIFICATION_STATUSES, MAX_ATTEMPTS, PAGE_SIZE, createNotificationService,
} = require('../src/modules/heera/notificationService');

const MIGRATIONS = path.join(__dirname, '../src/database/migrations');
const NOW = '2026-11-04T15:00:00.000Z';
const at = minutes => new Date(Date.parse(NOW) + minutes * 60 * 1000).toISOString();

let dir;
let db;
let clock;
let sent;
let failNext;
let service;

const addUser = (email = `${randomUUID()}@example.com`) => {
  const id = randomUUID();
  db.prepare('INSERT INTO user_credentials (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, 'x');
  return id;
};
const fakeSend = async mail => {
  sent.push(mail);
  if (failNext.length) throw failNext.shift();
};
const input = (userId, overrides = {}) => ({ userId, eventKey: `appointment.booked:${randomUUID()}`,
  type: 'appointment.booked', subject: 'Appointment booked', message: 'Your appointment is booked.', ...overrides });
const enqueue = (data, svc = service) => withWriteTransaction(db, tx => svc.enqueueNotification(tx, data));

const expectError = async (fn, status, code, message) => {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ status, code, ...(message ? { message } : {}) });
  return caught;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-heera-notify-'));
  db = openDatabase({ filename: path.join(dir, 'test.sqlite') });
  runMigrations(db);
  clock = new Date(NOW);
  sent = [];
  failNext = [];
  service = createNotificationService(db, { send: fakeSend, now: () => clock });
});

afterEach(() => {
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('007_notifications migration', () => {
  test('applies last, on top of a database that already has 006', () => {
    expect(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().at(-1).name)
      .toBe('007_notifications.sql');
    const staged = path.join(dir, 'migrations');
    fs.mkdirSync(staged);
    const copy = name => fs.copyFileSync(path.join(MIGRATIONS, name), path.join(staged, name));
    fs.readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql') && name < '007').forEach(copy);
    const old = openDatabase({ filename: path.join(dir, 'old.sqlite') });
    try {
      runMigrations(old, staged);
      copy('007_notifications.sql');
      expect(runMigrations(old, staged)).toEqual(['007_notifications.sql']);
    } finally {
      old.close();
    }
  });

  test('enforces statuses, attempt limits, unique event keys, timestamps and foreign keys', () => {
    const userId = addUser();
    const insert = (overrides = {}) => {
      const row = { id: randomUUID(), user_id: userId, event_key: randomUUID(), type: 'appointment.booked',
        subject: 's', message: 'm', status: 'pending', attempts: 0, created_at: NOW, updated_at: NOW,
        sent_at: null, viewed_at: null, ...overrides };
      db.prepare(`INSERT INTO notification (id, user_id, event_key, type, subject, message, status, attempts,
        created_at, updated_at, sent_at, viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(...Object.values(row));
      return row;
    };
    expect(() => insert({ status: 'queued' })).toThrow(/CHECK/);
    expect(() => insert({ attempts: 4 })).toThrow(/CHECK/);
    expect(() => insert({ status: 'sent' })).toThrow(/CHECK/);
    expect(() => insert({ status: 'viewed' })).toThrow(/CHECK/);
    expect(() => insert({ created_at: '2026-11-04 15:00' })).toThrow(/CHECK/);
    expect(() => insert({ user_id: randomUUID() })).toThrow(/FOREIGN KEY/);
    const first = insert();
    expect(() => insert({ event_key: first.event_key })).toThrow(/UNIQUE/);
    expect(() => insert({ status: 'sent', sent_at: NOW })).not.toThrow();
  });
});

describe('enqueueNotification', () => {
  test('saves a pending notification inside the caller\'s transaction', () => {
    const userId = addUser();
    const data = input(userId);
    const { notification, created } = enqueue(data);
    expect(created).toBe(true);
    expect(notification).toEqual({ id: expect.any(String), userId, eventKey: data.eventKey,
      type: 'appointment.booked', subject: 'Appointment booked', message: 'Your appointment is booked.',
      status: 'pending', attempts: 0, lastError: null, createdAt: NOW, updatedAt: NOW, sentAt: null, viewedAt: null });
  });

  test('is idempotent per event key', () => {
    const userId = addUser();
    const data = input(userId);
    const first = enqueue(data).notification;
    const again = enqueue({ ...data, message: 'Different text.' });
    expect(again).toEqual({ notification: first, created: false });
    expect(db.prepare('SELECT count(*) AS n FROM notification').get().n).toBe(1);
    expect(() => enqueue({ ...data, userId: addUser() })).toThrow(expect.objectContaining({
      status: 409, code: 'EVENT_KEY_CONFLICT' }));
  });

  test('rolls back with the triggering action', () => {
    const userId = addUser();
    expect(() => withWriteTransaction(db, tx => {
      service.enqueueNotification(tx, input(userId));
      throw new Error('booking failed');
    })).toThrow('booking failed');
    expect(db.prepare('SELECT count(*) AS n FROM notification').get().n).toBe(0);
  });

  test('refuses to run outside a transaction and validates input', () => {
    const userId = addUser();
    expect(() => service.enqueueNotification(db, input(userId))).toThrow(/inside a write transaction/);
    for (const bad of [{}, input('u1'), input(userId, { type: 'Booked' }), input(userId, { subject: ' ' }),
      input(userId, { eventKey: '' }), { ...input(userId), extra: 1 }]) {
      expect(() => enqueue(bad)).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION_ERROR' }));
    }
  });
});

describe('deliverNotification', () => {
  test('emails the user after commit and marks it sent', async () => {
    const userId = addUser('ana@example.com');
    const { notification } = enqueue(input(userId));
    clock = new Date(at(1));
    const delivered = await service.deliverNotification(notification.id);
    expect(sent).toEqual([{ to: 'ana@example.com', subject: 'Appointment booked',
      text: 'Your appointment is booked.', notification: expect.objectContaining({ id: notification.id, attempts: 1 }) }]);
    expect(delivered).toMatchObject({ status: 'sent', attempts: 1, sentAt: at(1), lastError: null, updatedAt: at(1) });
  });

  test('sends with no transaction open', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    let open;
    const svc = createNotificationService(db, { send: async () => { open = db.isTransaction; } });
    await svc.deliverNotification(notification.id);
    expect(open).toBe(false);
  });

  test('records a failed send without throwing', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    failNext.push(new Error('SMTP timeout'));
    const failed = await service.deliverNotification(notification.id);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, lastError: 'SMTP timeout', sentAt: null });
  });

  test('uses a generic error message when the sender throws nothing useful', async () => {
    const userId = addUser();
    const ids = [enqueue(input(userId)).notification.id, enqueue(input(userId)).notification.id];
    failNext.push(undefined, { message: 'x'.repeat(600) });
    expect((await service.deliverNotification(ids[0])).lastError).toBe('Delivery failed.');
    expect((await service.deliverNotification(ids[1])).lastError).toHaveLength(500);
  });

  test('does nothing for notifications that are not pending', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    await service.deliverNotification(notification.id);
    const again = await service.deliverNotification(notification.id);
    expect(again).toMatchObject({ status: 'sent', attempts: 1 });
    expect(sent).toHaveLength(1);
    await expectError(() => service.deliverNotification(randomUUID()), 404, 'NOT_FOUND');
  });

  test('a second delivery while one is in flight does not send twice', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    let release;
    const svc = createNotificationService(db, { send: () => new Promise(resolve => { release = resolve; }) });
    const first = svc.deliverNotification(notification.id);
    const second = await svc.deliverNotification(notification.id);
    expect(second).toMatchObject({ status: 'pending', attempts: 1 });
    release();
    expect(await first).toMatchObject({ status: 'sent', attempts: 1 });
  });

  test('marks a stuck pending notification failed once it has used every attempt', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    db.prepare('UPDATE notification SET attempts = ? WHERE id = ?').run(MAX_ATTEMPTS, notification.id);
    const result = await service.deliverNotification(notification.id);
    expect(result).toMatchObject({ status: 'failed', attempts: 3, lastError: 'Delivery attempt limit reached.' });
    expect(sent).toEqual([]);
  });

  test('keeps a viewed status set while the email was being sent', async () => {
    const userId = addUser();
    const ids = [enqueue(input(userId)).notification.id, enqueue(input(userId)).notification.id];
    const viewing = async (mail, fail) => {
      service.markViewed(mail.notification.id, userId);
      if (fail) throw new Error('bounced');
    };
    const ok = createNotificationService(db, { send: mail => viewing(mail, false), now: () => clock });
    const bad = createNotificationService(db, { send: mail => viewing(mail, true), now: () => clock });
    expect(await ok.deliverNotification(ids[0])).toMatchObject({ status: 'viewed', sentAt: NOW });
    expect(await bad.deliverNotification(ids[1])).toMatchObject({ status: 'viewed', sentAt: null, lastError: 'bounced' });
  });

  test('defaults to a simulated sender and the real clock', async () => {
    const userId = addUser();
    const svc = createNotificationService(db);
    const { notification } = withWriteTransaction(db, tx => svc.enqueueNotification(tx, input(userId)));
    expect(await svc.deliverNotification(notification.id)).toMatchObject({ status: 'sent', attempts: 1 });
  });
});

describe('retryNotification', () => {
  test('retries a failed notification, up to three attempts in total', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    failNext.push(new Error('one'), new Error('two'), new Error('three'));
    await service.deliverNotification(notification.id);
    expect(await service.retryNotification(notification.id)).toMatchObject({ status: 'failed', attempts: 2,
      lastError: 'two' });
    expect(await service.retryNotification(notification.id)).toMatchObject({ status: 'failed', attempts: 3 });
    await expectError(() => service.retryNotification(notification.id), 409, 'RETRY_LIMIT_REACHED',
      'This notification has already been attempted 3 times.');
    expect(sent).toHaveLength(3);
  });

  test('a successful retry marks it sent', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    failNext.push(new Error('down'));
    await service.deliverNotification(notification.id);
    expect(await service.retryNotification(notification.id)).toMatchObject({ status: 'sent', attempts: 2,
      lastError: null });
  });

  test('only failed notifications can be retried', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    await expectError(() => service.retryNotification(notification.id), 409, 'INVALID_STATUS',
      'Only failed notifications can be retried; this one is pending.');
    await expectError(() => service.retryNotification(randomUUID()), 404, 'NOT_FOUND');
  });
});

describe('markViewed', () => {
  test('marks the owner\'s notification viewed once', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    await service.deliverNotification(notification.id);
    clock = new Date(at(5));
    expect(service.markViewed(notification.id, userId)).toMatchObject({ status: 'viewed', viewedAt: at(5) });
    clock = new Date(at(9));
    expect(service.markViewed(notification.id, userId).viewedAt).toBe(at(5));
  });

  test('a viewed pending notification is not emailed', async () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    service.markViewed(notification.id, userId);
    expect(await service.deliverNotification(notification.id)).toMatchObject({ status: 'viewed', attempts: 0 });
    expect(sent).toEqual([]);
  });

  test('404s for another user\'s or an unknown notification', () => {
    const userId = addUser();
    const { notification } = enqueue(input(userId));
    expect(() => service.markViewed(notification.id, addUser())).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => service.markViewed(randomUUID(), userId)).toThrow(expect.objectContaining({ status: 404 }));
    expect(service.getNotification(notification.id).status).toBe('pending');
    expect(service.findById(randomUUID())).toBeNull();
  });
});

describe('history listing', () => {
  test('pages a user\'s notifications 20 at a time, newest first', () => {
    const ana = addUser();
    const ben = addUser();
    const ids = [];
    for (let i = 0; i < 25; i += 1) {
      clock = new Date(at(i));
      ids.push(enqueue(input(ana)).notification.id);
    }
    enqueue(input(ben));
    // Same timestamp: the later insert comes first.
    const tie = enqueue(input(ana)).notification.id;

    const first = service.listForUser(ana);
    expect(first).toMatchObject({ page: 1, pageSize: PAGE_SIZE, total: 26, totalPages: 2 });
    expect(first.items).toHaveLength(20);
    expect(first.items.slice(0, 3).map(n => n.id)).toEqual([tie, ids[24], ids[23]]);
    const second = service.listForUser(ana, { page: '2' });
    expect(second.items.map(n => n.id)).toEqual(ids.slice(0, 6).reverse());
    expect(service.listForUser(ana, { page: 3 }).items).toEqual([]);
    expect(service.listForUser(addUser())).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });

  test('filters by status and lists across users for admins', async () => {
    const ana = addUser();
    const ben = addUser();
    const a = enqueue(input(ana)).notification;
    const b = enqueue(input(ben)).notification;
    failNext.push(new Error('down'));
    await service.deliverNotification(b.id);
    expect(service.listForUser(ana, { status: 'pending' }).items.map(n => n.id)).toEqual([a.id]);
    expect(service.listForUser(ana, { status: 'failed' }).total).toBe(0);
    expect(service.listAll().total).toBe(2);
    expect(service.listAll({ status: 'failed' }).items.map(n => n.id)).toEqual([b.id]);
  });

  test('rejects bad page options', () => {
    for (const options of [{ page: 0 }, { page: 1.5 }, { page: 'x' }, { status: 'queued' }, { size: 50 }]) {
      expect(() => service.listAll(options)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  test('exports the plan constants', () => {
    expect(NOTIFICATION_STATUSES).toEqual(['pending', 'sent', 'failed', 'viewed']);
    expect([MAX_ATTEMPTS, PAGE_SIZE]).toEqual([3, 20]);
  });
});
