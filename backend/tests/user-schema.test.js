const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  openDatabase,
  withWriteTransaction,
} = require('../src/database/connection');

const { runMigrations } = require('../src/database/migrate');

describe('Credentials and profile schema', () => {
  let directory;
  let filename;
  let db;

  // Schema fixture only; this is not a real password hash.
  const HASH = 'test-only-hash';

  function credentials(overrides = {}) {
    const row = {
      id: randomUUID(),
      email: 'nik@example.com',
      passwordHash: HASH,
      role: 'User',
      ...overrides,
    };

    db.prepare(`
      INSERT INTO user_credentials (
        id, email, password_hash, role
      )
      VALUES (?, ?, ?, ?)
    `).run(
      row.id,
      row.email,
      row.passwordHash,
      row.role
    );

    return row;
  }

  function profile(overrides = {}) {
    const row = {
      email: 'nik@example.com',
      fullName: 'Nik Nambisseril',
      phone: null,
      preferences: '{}',
      ...overrides,
    };

    db.prepare(`
      INSERT INTO user_profile (
        email, full_name, phone, preferences_json
      )
      VALUES (?, ?, ?, ?)
    `).run(
      row.email,
      row.fullName,
      row.phone,
      row.preferences
    );
  }

  beforeEach(() => {
    directory = mkdtempSync(
      path.join(tmpdir(), 'queuesmart-user-schema-')
    );

    filename = path.join(directory, 'test.sqlite');
    db = openDatabase({ filename });

    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('stores both records atomically and survives reopening', () => {
    const id = randomUUID();

    withWriteTransaction(db, () => {
      credentials({ id });

      profile({
        phone: '+1 555 010 0000',
        preferences: '{"emailNotifications":true}',
      });
    });

    db.close();
    db = openDatabase({ filename });

    const row = db.prepare(`
      SELECT
        c.id,
        c.role,
        p.full_name,
        p.phone,
        p.preferences_json
      FROM user_credentials c
      JOIN user_profile p ON p.email = c.email
      WHERE c.id = ?
    `).get(id);

    expect(row.id).toBe(id);
    expect(row.role).toBe('User');
    expect(row.full_name).toBe('Nik Nambisseril');
    expect(row.phone).toBe('+1 555 010 0000');

    expect(JSON.parse(row.preferences_json)).toEqual({
      emailNotifications: true,
    });
  });

  test('uses defaults for role, phone, and preferences', () => {
    db.prepare(`
      INSERT INTO user_credentials (
        id, email, password_hash
      )
      VALUES (?, ?, ?)
    `).run(randomUUID(), 'nik@example.com', HASH);

    db.prepare(`
      INSERT INTO user_profile (email, full_name)
      VALUES (?, ?)
    `).run('nik@example.com', 'Nik Nambisseril');

    expect(
      db.prepare('SELECT role FROM user_credentials').get().role
    ).toBe('User');

    const row = db.prepare(`
      SELECT phone, preferences_json FROM user_profile
    `).get();

    expect(row.phone).toBeNull();
    expect(row.preferences_json).toBe('{}');
  });

  test('rejects duplicate emails and duplicate profiles', () => {
    credentials();
    expect(() => credentials()).toThrow();

    profile();
    expect(() => profile()).toThrow();
  });

  test.each([
    ['missing ID', { id: null }],
    ['invalid ID length', { id: 'short' }],
    ['missing email', { email: null }],
    ['long email', { email: 'a'.repeat(255) }],
    ['uppercase email', { email: 'Nik@example.com' }],
    ['untrimmed email', { email: ' nik@example.com ' }],
    ['empty hash', { passwordHash: '' }],
    ['long hash', { passwordHash: 'x'.repeat(513) }],
    ['invalid role', { role: 'SuperUser' }],
  ])('rejects credentials: %s', (_label, input) => {
    expect(() => credentials(input)).toThrow();
  });

  test('accepts the Administrator database role', () => {
    credentials({ role: 'Administrator' });

    expect(
      db.prepare('SELECT role FROM user_credentials').get().role
    ).toBe('Administrator');
  });

  test('rejects a profile without matching credentials', () => {
    expect(() => profile()).toThrow();
  });

  test.each([
    ['missing name', { fullName: null }],
    ['blank name', { fullName: '   ' }],
    ['long name', { fullName: 'a'.repeat(101) }],
    ['empty phone', { phone: '' }],
    ['long phone', { phone: '1'.repeat(31) }],
    ['malformed JSON', { preferences: '{' }],
    ['JSON array', { preferences: '[]' }],
    [
      'oversized preferences',
      {
        preferences: JSON.stringify({
          text: 'x'.repeat(4096),
        }),
      },
    ],
    [
      'oversized UTF-8 preferences',
      {
        preferences: JSON.stringify({
          text: '\u00e9'.repeat(2100),
        }),
      },
    ],
  ])('rejects profile: %s', (_label, input) => {
    credentials();
    expect(() => profile(input)).toThrow();
  });

  test('rolls back credentials when profile creation fails', () => {
    expect(() =>
      withWriteTransaction(db, () => {
        credentials();
        profile({ fullName: '' });
      })
    ).toThrow();

    expect(
      db.prepare(`
        SELECT COUNT(*) AS count FROM user_credentials
      `).get().count
    ).toBe(0);

    expect(
      db.prepare(`
        SELECT COUNT(*) AS count FROM user_profile
      `).get().count
    ).toBe(0);
  });

  test('restricts deletion and cascades an internal email update', () => {
    credentials();
    profile();

    expect(() =>
      db.prepare(`
        DELETE FROM user_credentials WHERE email = ?
      `).run('nik@example.com')
    ).toThrow();

    db.prepare(`
      UPDATE user_credentials
      SET email = ?
      WHERE email = ?
    `).run('updated@example.com', 'nik@example.com');

    expect(
      db.prepare('SELECT email FROM user_profile').get().email
    ).toBe('updated@example.com');
  });
});