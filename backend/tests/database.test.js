const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const {
  openDatabase,
  withWriteTransaction,
} = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');

describe('SQLite foundation', () => {
  let directory;
  let filename;
  let migrations;
  let db;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'queuesmart-db-'));
    filename = path.join(directory, 'data', 'test.sqlite');
    migrations = path.join(directory, 'migrations');

    mkdirSync(migrations);
    db = openDatabase({ filename });
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const migration = (folder, name, sql) => {
    writeFileSync(path.join(folder, name), sql);
  };

  test('enables foreign keys, WAL, and the busy timeout', () => {
    expect(
      db.prepare('PRAGMA foreign_keys').get().foreign_keys
    ).toBe(1);

    expect(
      db.prepare('PRAGMA journal_mode').get().journal_mode
    ).toBe('wal');

    expect(
      db.prepare('PRAGMA busy_timeout').get().timeout
    ).toBe(5000);

    db.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY);
      CREATE TABLE child (
        parent_id TEXT REFERENCES parent(id)
      );
    `);

    expect(() =>
      db.prepare('INSERT INTO child VALUES (?)').run('missing')
    ).toThrow();
  });

  test('commits data and retrieves it after reopening the file', () => {
    db.exec('CREATE TABLE sample (value TEXT NOT NULL) STRICT');

    const result = withWriteTransaction(db, tx => {
      tx.prepare('INSERT INTO sample VALUES (?)').run('saved');
      return 'committed';
    });

    expect(result).toBe('committed');

    db.close();
    db = openDatabase({ filename });

    expect(
      db.prepare('SELECT value FROM sample').get().value
    ).toBe('saved');
  });

  test('rolls back a failed write and remains usable', () => {
    db.exec('CREATE TABLE sample (value TEXT) STRICT');

    expect(() =>
      withWriteTransaction(db, tx => {
        tx.prepare('INSERT INTO sample VALUES (?)').run('discard');
        throw new Error('abort');
      })
    ).toThrow('abort');

    expect(
      db.prepare('SELECT COUNT(*) AS total FROM sample').get().total
    ).toBe(0);

    expect(withWriteTransaction(db, () => 7)).toBe(7);
    expect(
      withWriteTransaction(db, () => undefined)
    ).toBeUndefined();
  });

  test('rejects a Promise returned from a transaction callback', () => {
    expect(() =>
      withWriteTransaction(db, () => Promise.resolve(1))
    ).toThrow('must be synchronous');

    expect(withWriteTransaction(db, () => 1)).toBe(1);
  });

  test('maps a competing writer to DATABASE_BUSY', () => {
    const other = openDatabase({ filename });

    // Keep this contention test quick.
    other.exec('PRAGMA busy_timeout = 1');
    db.exec('BEGIN IMMEDIATE');

    try {
      expect(() =>
        withWriteTransaction(other, () => {})
      ).toThrow(
        expect.objectContaining({
          status: 503,
          code: 'DATABASE_BUSY',
        })
      );
    } finally {
      db.exec('ROLLBACK');
      other.close();
    }
  });

  test('initializes tracking with no entity migrations', () => {
    expect(runMigrations(db, migrations)).toEqual([]);
    expect(runMigrations(db, migrations)).toEqual([]);
  });

  test('applies migrations in order and only once', () => {
    migration(
      migrations,
      '002_second.sql',
      "INSERT INTO sample VALUES ('once');"
    );

    migration(
      migrations,
      '001_first.sql',
      'CREATE TABLE sample (value TEXT) STRICT;'
    );

    expect(runMigrations(db, migrations)).toEqual([
      '001_first.sql',
      '002_second.sql',
    ]);

    expect(runMigrations(db, migrations)).toEqual([]);

    expect(
      db.prepare('SELECT COUNT(*) AS total FROM sample').get().total
    ).toBe(1);
  });

  test('rolls back the entire pending batch on failure', () => {
    migration(
      migrations,
      '001_first.sql',
      'CREATE TABLE sample (value TEXT) STRICT;'
    );

    migration(
      migrations,
      '002_bad.sql',
      'INSERT INTO missing_table VALUES (1);'
    );

    expect(() => runMigrations(db, migrations)).toThrow();

    expect(
      db.prepare(`
        SELECT name FROM sqlite_master WHERE name = 'sample'
      `).get()
    ).toBeUndefined();
  });

  test('rejects changed applied migrations', () => {
    migration(
      migrations,
      '001_first.sql',
      'CREATE TABLE sample (value TEXT) STRICT;'
    );

    runMigrations(db, migrations);

    migration(
      migrations,
      '001_first.sql',
      'CREATE TABLE changed (value TEXT) STRICT;'
    );

    expect(() =>
      runMigrations(db, migrations)
    ).toThrow('changed or is missing');
  });

  test('rejects invalid filenames and duplicate versions', () => {
    migration(migrations, 'bad.sql', 'SELECT 1;');

    expect(() =>
      runMigrations(db, migrations)
    ).toThrow('Invalid or duplicate');

    rmSync(path.join(migrations, 'bad.sql'));

    migration(migrations, '001_first.sql', 'SELECT 1;');
    migration(migrations, '001_duplicate.sql', 'SELECT 1;');

    expect(() =>
      runMigrations(db, migrations)
    ).toThrow('Invalid or duplicate');
  });

  test('rejects adding an older migration after a later one', () => {
    migration(migrations, '002_second.sql', 'SELECT 1;');
    runMigrations(db, migrations);

    migration(migrations, '001_first.sql', 'SELECT 1;');

    expect(() =>
      runMigrations(db, migrations)
    ).toThrow('older than the applied schema');
  });
});