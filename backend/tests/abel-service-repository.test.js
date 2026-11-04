const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDatabase, withWriteTransaction } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');
const { PRIORITY_LABELS, createServiceRepository } = require('../src/modules/abel/serviceRepository');

let dir;
let file;
let db;
let repo;

const open = () => openDatabase({ filename: file });

const advising = { name: 'Student Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priorityLevel: 1 };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-abel-'));
  file = path.join(dir, 'test.sqlite');
  db = open();
  runMigrations(db);
  repo = createServiceRepository(db);
});

afterEach(() => {
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const expectApiError = (fn, status, code) => {
  try {
    fn();
  } catch (err) {
    expect(err).toMatchObject({ status, code });
    return;
  }
  throw new Error('Expected an ApiError');
};

test('creates a service that findById and getService return', () => {
  const created = repo.create({ ...advising, name: '  Student Advising  ' });
  expect(created).toEqual({ id: expect.any(String), ...advising, isActive: true });
  expect(repo.findById(created.id)).toEqual(created);
  expect(repo.getService(created.id)).toEqual({ id: created.id, name: 'Student Advising',
    expectedDurationMinutes: 15, priorityLevel: 1, isActive: true });
});

test('applies defaults for description, priority, and active state', () => {
  const created = repo.create({ name: 'IT Help Desk', expectedDurationMinutes: 10 });
  expect(created).toMatchObject({ description: '', priorityLevel: 0, isActive: true });
});

test('migrations 001-003 apply together on a fresh database', () => {
  const names = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map(row => row.name);
  expect(names).toEqual(['001_user_credentials.sql', '002_user_profile.sql', '003_services.sql']);
});

test('exposes priority labels', () => {
  expect(PRIORITY_LABELS).toEqual({ 0: 'normal', 1: 'high', 2: 'urgent' });
});

test('lists services in creation order and filters active ones', () => {
  const first = repo.create(advising);
  const second = repo.create({ name: 'DMV Services', expectedDurationMinutes: 20, isActive: false });
  expect(repo.list().map(s => s.id)).toEqual([first.id, second.id]);
  expect(repo.list({ activeOnly: true }).map(s => s.id)).toEqual([first.id]);
});

test('updates only the supplied fields', () => {
  const created = repo.create(advising);
  const updated = repo.update(created.id, { expectedDurationMinutes: 30, isActive: false });
  expect(updated).toEqual({ ...created, expectedDurationMinutes: 30, isActive: false });
  expect(repo.findById(created.id)).toEqual(updated);
});

test('missing services return null or NOT_FOUND', () => {
  expect(repo.findById('missing')).toBeNull();
  expectApiError(() => repo.getService('missing'), 404, 'NOT_FOUND');
  expectApiError(() => repo.update('missing', { name: 'X' }), 404, 'NOT_FOUND');
});

test.each([
  ['empty name', { name: '' }],
  ['whitespace name', { name: '   ' }],
  ['101-character name', { name: 'a'.repeat(101) }],
  ['1001-character description', { description: 'a'.repeat(1001) }],
  ['zero duration', { expectedDurationMinutes: 0 }],
  ['481 minute duration', { expectedDurationMinutes: 481 }],
  ['fractional duration', { expectedDurationMinutes: 1.5 }],
  ['string duration', { expectedDurationMinutes: '30' }],
  ['priority 3', { priorityLevel: 3 }],
  ['extra field', { isOpen: true }],
])('create rejects %s without storing it', (_label, change) => {
  expectApiError(() => repo.create({ ...advising, ...change }), 400, 'VALIDATION_ERROR');
  expect(repo.list()).toEqual([]);
});

test('create rejects a missing name', () => {
  expectApiError(() => repo.create({ expectedDurationMinutes: 10 }), 400, 'VALIDATION_ERROR');
});

test.each([
  ['empty patch', {}],
  ['extra field', { id: 'other' }],
  ['invalid duration', { expectedDurationMinutes: 0 }],
])('update rejects %s and leaves the row unchanged', (_label, patch) => {
  const created = repo.create(advising);
  expectApiError(() => repo.update(created.id, patch), 400, 'VALIDATION_ERROR');
  expect(repo.findById(created.id)).toEqual(created);
});

const insert = row => db.prepare(`INSERT INTO service (id, name, description, expected_duration_minutes,
  priority_level, is_active) VALUES (?, ?, ?, ?, ?, ?)`).run(row.id ?? randomUUID(), row.name ?? 'Valid',
  row.description ?? '', row.duration ?? 10, row.priority ?? 0, row.active ?? 1);

test.each([
  ['zero duration', { duration: 0 }],
  ['481 minute duration', { duration: 481 }],
  ['priority 3', { priority: 3 }],
  ['is_active 2', { active: 2 }],
  ['untrimmed name', { name: ' Padded ' }],
  ['empty name', { name: '' }],
  ['1001-character description', { description: 'a'.repeat(1001) }],
])('database CHECK constraints reject %s', (_label, row) => {
  expect(() => insert(row)).toThrow(/CHECK constraint failed/);
});

test.each([
  ['fractional duration', { duration: 1.5 }],
  ['text duration', { duration: 'thirty' }],
  ['text priority', { priority: 'high' }],
])('STRICT column types reject %s', (_label, row) => {
  expect(() => insert(row)).toThrow(/cannot store/);
});

test('database rejects bad ids, duplicate ids, and missing names', () => {
  const id = randomUUID();
  insert({ id });
  expect(() => insert({ id })).toThrow(/UNIQUE constraint failed/);
  expect(() => insert({ id: 'short' })).toThrow(/CHECK constraint failed/);
  expect(() => db.prepare('INSERT INTO service (id, expected_duration_minutes) VALUES (?, ?)')
    .run(randomUUID(), 10)).toThrow(/NOT NULL constraint failed/);
});

test('services persist after the database is closed and reopened', () => {
  const created = repo.create(advising);
  db.close();
  db = open();
  expect(createServiceRepository(db).findById(created.id)).toEqual(created);
});

test('getService and update use a supplied transaction connection', () => {
  const created = repo.create(advising);
  const other = open();
  const rollback = new Error('rollback');
  try {
    expect(() => withWriteTransaction(other, tx => {
      repo.update(created.id, { name: 'Renamed' }, tx);
      expect(repo.getService(created.id, tx).name).toBe('Renamed');
      expect(repo.findById(created.id).name).toBe('Student Advising');
      throw rollback;
    })).toThrow(rollback);
  } finally {
    other.close();
  }
  expect(repo.getService(created.id).name).toBe('Student Advising');
});

test('changes made in a committed transaction are visible afterwards', () => {
  const created = withWriteTransaction(db, tx => repo.create(advising, tx));
  expect(repo.findById(created.id)).toEqual(created);
});
