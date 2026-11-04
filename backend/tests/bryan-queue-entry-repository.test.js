const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase, withWriteTransaction } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const {
  ENTRY_STATUSES, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, createQueueEntryRepository,
} = require('../src/modules/bryan/queueEntryRepository');

const UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const T0 = '2026-11-04T01:00:00.000Z';

let dir;
let file;
let db;
let clock;
let repo;

const fixedClock = () => {
  let ms = Date.parse(T0);
  return () => { const d = new Date(ms); ms += 1000; return d; };
};

const open = () => {
  db = openDatabase({ filename: file });
  runMigrations(db);
  repo = createQueueEntryRepository(db, { now: clock });
};

const addUser = () => {
  const id = randomUUID();
  db.prepare("INSERT INTO user_credentials (id, email, password_hash) VALUES (?, ?, 'hash')")
    .run(id, `${id}@example.com`);
  return id;
};
const addQueue = (status = 'open') => {
  const serviceId = randomUUID();
  const queueId = randomUUID();
  db.prepare("INSERT INTO service (id, name, expected_duration_minutes) VALUES (?, 'Advising', 15)").run(serviceId);
  db.prepare('INSERT INTO queue (id, service_id, status, created_at) VALUES (?, ?, ?, ?)')
    .run(queueId, serviceId, status, T0);
  return queueId;
};
const rawInsert = values => {
  const row = { id: randomUUID(), priority_level: 0, position: 1, joined_at: T0, status: 'waiting',
    finished_at: null, ...values };
  db.prepare(`INSERT INTO queue_entry (id, queue_id, user_id, priority_level, position, joined_at, status, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.queue_id, row.user_id, row.priority_level, row.position, row.joined_at, row.status, row.finished_at);
  return row.id;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-bryan-entries-'));
  file = path.join(dir, 'test.sqlite');
  clock = fixedClock();
  open();
});

afterEach(() => {
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('005_queue_entry migration', () => {
  test('applies in order after 004 and creates the table and indexes', () => {
    const names = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(r => r.name);
    expect(names.indexOf('005_queue_entry.sql')).toBe(names.indexOf('004_queues.sql') + 1);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'queue_entry'")
      .all().map(r => r.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_queue_entry_one_waiting', 'idx_queue_entry_waiting_order', 'idx_queue_entry_user_history']));
  });

  test('accepts a valid waiting entry and a valid finished entry', () => {
    const queue_id = addQueue();
    const user_id = addUser();
    expect(() => rawInsert({ queue_id, user_id })).not.toThrow();
    expect(() => rawInsert({ queue_id, user_id, status: 'served', position: 0,
      finished_at: '2026-11-04T01:05:00.000Z' })).not.toThrow();
  });

  test('rejects unknown queue and user references', () => {
    const queue_id = addQueue();
    const user_id = addUser();
    expect(() => rawInsert({ queue_id: randomUUID(), user_id })).toThrow(/FOREIGN KEY/);
    expect(() => rawInsert({ queue_id, user_id: randomUUID() })).toThrow(/FOREIGN KEY/);
  });

  test('rejects invalid priority, status, position, IDs and timestamps', () => {
    const queue_id = addQueue();
    const user_id = addUser();
    const bad = [
      { priority_level: 3 }, { priority_level: -1 }, { priority_level: 'high' }, { priority_level: 1.5 },
      { status: 'left' }, { status: 'removed' },
      { position: 0 }, { position: -1 }, { position: 'first' },
      { id: 'short-id' },
      { joined_at: '2026-11-04T01:00:00Z' }, { joined_at: '2026-11-04 01:00:00.000' },
      { finished_at: '2026-11-04T01:05:00.000Z' }, 
      { status: 'served', position: 1, finished_at: '2026-11-04T01:05:00.000Z' }, 
      { status: 'canceled', position: 0, finished_at: null }, 
      { status: 'served', position: 0, finished_at: '2026-11-04T00:59:59.000Z' }, 
    ];
    for (const values of bad) {
      expect(() => rawInsert({ queue_id, user_id, ...values })).toThrow();
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM queue_entry').get().n).toBe(0);
  });

  test('numbers are always stored as INTEGER (STRICT table)', () => {
    const id = rawInsert({ queue_id: addQueue(), user_id: addUser(), position: '1', priority_level: '2' });
    const row = db.prepare('SELECT typeof(position) AS p, typeof(priority_level) AS l FROM queue_entry WHERE id = ?')
      .get(id);
    expect({ ...row }).toEqual({ p: 'integer', l: 'integer' });
  });

  test('allows only one waiting entry per user per queue but keeps history', () => {
    const queue_id = addQueue();
    const other = addQueue();
    const user_id = addUser();
    rawInsert({ queue_id, user_id });
    expect(() => rawInsert({ queue_id, user_id, position: 2 })).toThrow(/UNIQUE/);
    expect(() => rawInsert({ queue_id: other, user_id })).not.toThrow();
    rawInsert({ queue_id, user_id, status: 'canceled', position: 0, finished_at: '2026-11-04T01:05:00.000Z' });
    rawInsert({ queue_id, user_id, status: 'served', position: 0, finished_at: '2026-11-04T01:06:00.000Z' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM queue_entry WHERE user_id = ?').get(user_id).n).toBe(4);
  });

  test('a user or queue with entries cannot be deleted', () => {
    const queue_id = addQueue();
    const user_id = addUser();
    rawInsert({ queue_id, user_id });
    expect(() => db.prepare('DELETE FROM user_credentials WHERE id = ?').run(user_id)).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare('DELETE FROM queue WHERE id = ?').run(queue_id)).toThrow(/FOREIGN KEY/);
  });
});

describe('queue entry repository', () => {
  test('insertWaiting stores a camelCase entry with UUID, UTC time and position', () => {
    const queueId = addQueue();
    const userId = addUser();
    const entry = repo.insertWaiting({ queueId, userId, priorityLevel: 1 });
    expect(entry).toEqual({ id: expect.any(String), queueId, userId, position: 1, priorityLevel: 1,
      joinedAt: T0, status: 'waiting', finishedAt: null });
    expect(entry.id).toHaveLength(36);
    expect(entry.joinedAt).toMatch(UTC_MS);
    expect(repo.findById(entry.id)).toEqual(entry);
    expect(repo.findWaiting(queueId, userId)).toEqual(entry);
    expect(repo.findById(randomUUID())).toBeNull();
    expect(repo.findWaiting(queueId, addUser())).toBeNull();
  });

  test('orders by priority (high to low), then join time, then ID', () => {
    const queueId = addQueue();
    const normal1 = repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 0 });
    const high = repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 1 });
    const normal2 = repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 0 });
    const urgent = repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 2 });
    expect(repo.listWaiting(queueId).map(e => [e.id, e.position])).toEqual([
      [urgent.id, 1], [high.id, 2], [normal1.id, 3], [normal2.id, 4],
    ]);
  });

  test('identical join times fall back to ID order', () => {
    const queueId = addQueue();
    const ids = ['00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a'];
    ids.forEach((id, i) => rawInsert({ id, queue_id: queueId, user_id: addUser(), position: i + 1 }));
    repo.recalculatePositions(queueId);
    expect(repo.listWaiting(queueId).map(e => e.id)).toEqual([...ids].sort());
  });

  test('finishEntry marks served or canceled, sets position 0 and renumbers the rest', () => {
    const queueId = addQueue();
    const [a, b, c] = [0, 1, 2].map(() => repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 0 }));
    const served = repo.finishEntry(a.id, 'served');
    expect(served).toMatchObject({ id: a.id, status: 'served', position: 0 });
    expect(served.finishedAt).toMatch(UTC_MS);
    expect(served.finishedAt > served.joinedAt).toBe(true);
    expect(repo.listWaiting(queueId).map(e => [e.id, e.position])).toEqual([[b.id, 1], [c.id, 2]]);
    expect(repo.finishEntry(c.id, 'canceled')).toMatchObject({ status: 'canceled', position: 0 });
    expect(repo.listWaiting(queueId).map(e => [e.id, e.position])).toEqual([[b.id, 1]]);
  });

  test('finishEntry ignores entries that are missing or already finished, and rejects bad statuses', () => {
    const queueId = addQueue();
    const entry = repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 0 });
    expect(() => repo.finishEntry(entry.id, 'waiting')).toThrow(TypeError);
    expect(repo.finishEntry(randomUUID(), 'served')).toBeNull();
    repo.finishEntry(entry.id, 'served');
    expect(repo.finishEntry(entry.id, 'canceled')).toBeNull();
    expect(repo.findById(entry.id).status).toBe('served');
  });

  test('a user can rejoin after finishing and gets a new entry ID', () => {
    const queueId = addQueue();
    const userId = addUser();
    const first = repo.insertWaiting({ queueId, userId, priorityLevel: 0 });
    expect(() => repo.insertWaiting({ queueId, userId, priorityLevel: 0 })).toThrow(/UNIQUE/);
    repo.finishEntry(first.id, 'canceled');
    const second = repo.insertWaiting({ queueId, userId, priorityLevel: 0 });
    expect(second.id).not.toBe(first.id);
    expect(second.position).toBe(1);
  });

  test('database rejects inserts for unknown queues or users and bad priorities', () => {
    const queueId = addQueue();
    const userId = addUser();
    expect(() => repo.insertWaiting({ queueId: randomUUID(), userId, priorityLevel: 0 })).toThrow(/FOREIGN KEY/);
    expect(() => repo.insertWaiting({ queueId, userId: randomUUID(), priorityLevel: 0 })).toThrow(/FOREIGN KEY/);
    expect(() => repo.insertWaiting({ queueId, userId, priorityLevel: 5 })).toThrow(/CHECK/);
    expect(repo.listWaiting(queueId)).toEqual([]);
  });

  test('uses the real clock when none is supplied', () => {
    const before = new Date().toISOString();
    const entry = createQueueEntryRepository(db).insertWaiting({ queueId: addQueue(), userId: addUser(), priorityLevel: 0 });
    expect(entry.joinedAt >= before).toBe(true);
    expect(entry.joinedAt).toMatch(UTC_MS);
  });

  test('queues are numbered independently', () => {
    const q1 = addQueue();
    const q2 = addQueue();
    const userId = addUser();
    repo.insertWaiting({ queueId: q1, userId: addUser(), priorityLevel: 0 });
    expect(repo.insertWaiting({ queueId: q1, userId, priorityLevel: 0 }).position).toBe(2);
    expect(repo.insertWaiting({ queueId: q2, userId, priorityLevel: 0 }).position).toBe(1);
  });

  test('changes inside a failed transaction are rolled back', () => {
    const queueId = addQueue();
    const userId = addUser();
    expect(() => withWriteTransaction(db, tx => {
      repo.insertWaiting({ queueId, userId, priorityLevel: 0 }, tx);
      throw new Error('boom');
    })).toThrow('boom');
    expect(repo.listWaiting(queueId)).toEqual([]);
    const committed = withWriteTransaction(db, tx => repo.insertWaiting({ queueId, userId, priorityLevel: 0 }, tx));
    expect(repo.listWaiting(queueId)).toEqual([committed]);
  });
});

describe('queue history', () => {
  test('returns only that user\'s finished entries, newest first', () => {
    const q1 = addQueue();
    const q2 = addQueue();
    const me = addUser();
    const other = addUser();
    const a = repo.insertWaiting({ queueId: q1, userId: me, priorityLevel: 0 });
    const b = repo.insertWaiting({ queueId: q2, userId: me, priorityLevel: 0 });
    const theirs = repo.insertWaiting({ queueId: q1, userId: other, priorityLevel: 0 });
    repo.finishEntry(a.id, 'served');
    repo.finishEntry(theirs.id, 'canceled');
    repo.finishEntry(b.id, 'canceled');
    repo.insertWaiting({ queueId: q1, userId: me, priorityLevel: 0 }); 
    const history = repo.listHistory(me);
    expect(history.map(e => [e.id, e.status])).toEqual([[b.id, 'canceled'], [a.id, 'served']]);
    expect(history.every(e => e.userId === me && ENTRY_STATUSES.includes(e.status))).toBe(true);
  });

  test('pages 20 by default, at most 100, and supports offset', () => {
    const queueId = addQueue();
    const me = addUser();
    for (let i = 0; i < 105; i += 1) {
      repo.finishEntry(repo.insertWaiting({ queueId, userId: me, priorityLevel: 0 }).id, 'canceled');
    }
    expect(repo.listHistory(me)).toHaveLength(HISTORY_DEFAULT_LIMIT);
    expect(repo.listHistory(me, { limit: 500 })).toHaveLength(HISTORY_MAX_LIMIT);
    expect(repo.listHistory(me, { limit: 0 })).toHaveLength(1);
    const firstPage = repo.listHistory(me, { limit: 5 });
    const secondPage = repo.listHistory(me, { limit: 5, offset: 5 });
    expect(secondPage[0].finishedAt < firstPage[4].finishedAt).toBe(true);
    expect(repo.listHistory(me, { offset: -3 })[0]).toEqual(firstPage[0]);
    expect(repo.listHistory(me, { limit: 'x', offset: 'y' })).toHaveLength(HISTORY_DEFAULT_LIMIT);
  });

  test('entries and history survive closing and reopening the database', () => {
    const queueId = addQueue();
    const me = addUser();
    const waiting = repo.insertWaiting({ queueId, userId: me, priorityLevel: 0 });
    const done = repo.insertWaiting({ queueId, userId: addUser(), priorityLevel: 0 });
    repo.finishEntry(done.id, 'served');
    db.close();
    open(); 
    expect(repo.listWaiting(queueId)).toEqual([{ ...waiting, position: 1 }]);
    expect(repo.findById(done.id)).toMatchObject({ status: 'served', position: 0 });
  });
});