const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  PRIORITY_LABELS, readServiceMigration, createServiceRepository,
} = require('../src/modules/abel/serviceRepository');

let dir;
let file;
let db;
let repo;

const open = () => {
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA foreign_keys = ON');
  return conn;
};

const advising = { name: 'Student Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priorityLevel: 1 };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuesmart-abel-'));
  file = path.join(dir, 'test.sqlite');
  db = open();
  db.exec(readServiceMigration());
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
  priority_level, is_active) VALUES (?, ?, ?, ?, ?, ?)`).run(row.id ?? 'svc-1', row.name ?? 'Valid',
  row.description ?? '', row.duration ?? 10, row.priority ?? 0, row.active ?? 1);

test.each([
  ['zero duration', { duration: 0 }],
  ['481 minute duration', { duration: 481 }],
  ['fractional duration', { duration: 1.5 }],
  ['text duration', { duration: 'thirty' }],
  ['priority 3', { priority: 3 }],
  ['is_active 2', { active: 2 }],
  ['untrimmed name', { name: ' Padded ' }],
  ['empty name', { name: '' }],
  ['1001-character description', { description: 'a'.repeat(1001) }],
])('database CHECK constraints reject %s', (_label, row) => {
  expect(() => insert(row)).toThrow(/CHECK constraint failed/);
});

test('database rejects duplicate ids and missing names', () => {
  insert({});
  expect(() => insert({})).toThrow(/UNIQUE constraint failed/);
  expect(() => db.prepare('INSERT INTO service (id, expected_duration_minutes) VALUES (?, ?)')
    .run('svc-2', 10)).toThrow(/NOT NULL constraint failed/);
});

test('services persist after the database is closed and reopened', () => {
  const created = repo.create(advising);
  db.close();
  db = open();
  expect(createServiceRepository(db).findById(created.id)).toEqual(created);
});

test('getService and update use a supplied connection', () => {
  const created = repo.create(advising);
  const other = open();
  try {
    other.exec('BEGIN IMMEDIATE');
    repo.update(created.id, { name: 'Renamed' }, other);
    expect(repo.getService(created.id, other).name).toBe('Renamed');
    expect(repo.findById(created.id).name).toBe('Student Advising');
    other.exec('ROLLBACK');
  } finally {
    other.close();
  }
  expect(repo.getService(created.id).name).toBe('Student Advising');
});
