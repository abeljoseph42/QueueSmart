const { readdirSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { withWriteTransaction } = require('./connection');

function runMigrations(
  db,
  directory = path.join(__dirname, 'migrations')
) {
  const files = readdirSync(directory)
    .filter(name => name.endsWith('.sql'))
    .sort();

  const versions = new Set();

  const migrations = files.map(name => {
    const version = name.slice(0, 3);

    if (
      !/^\d{3}_[a-z0-9_]+\.sql$/.test(name) ||
      versions.has(version)
    ) {
      throw new Error(
        `Invalid or duplicate migration version: ${name}`
      );
    }

    versions.add(version);

    const sql = readFileSync(path.join(directory, name), 'utf8');
    const checksum = createHash('sha256')
      .update(sql)
      .digest('hex');

    return { name, sql, checksum };
  });

  return withWriteTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const applied = db.prepare(`
      SELECT name, checksum
      FROM schema_migrations
      ORDER BY name
    `).all();

    const current = new Map(
      migrations.map(migration => [migration.name, migration])
    );

    for (const row of applied) {
      if (current.get(row.name)?.checksum !== row.checksum) {
        throw new Error(
          `Applied migration changed or is missing: ${row.name}`
        );
      }
    }

    const completed = new Set(applied.map(row => row.name));
    const latest = applied.at(-1)?.name || '';
    const added = [];

    for (const migration of migrations) {
      if (completed.has(migration.name)) {
        continue;
      }

      if (migration.name < latest) {
        throw new Error(
          `Migration is older than the applied schema: ${migration.name}`
        );
      }

      db.exec(migration.sql);

      db.prepare(`
        INSERT INTO schema_migrations (name, checksum, applied_at)
        VALUES (?, ?, ?)
      `).run(
        migration.name,
        migration.checksum,
        new Date().toISOString()
      );

      added.push(migration.name);
    }

    return added;
  });
}

module.exports = { runMigrations };