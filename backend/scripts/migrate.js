const { openDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrate');

let db;

try {
  db = openDatabase();

  const applied = runMigrations(db);

  console.log(
    applied.length
      ? `Applied: ${applied.join(', ')}`
      : 'Database is up to date.'
  );
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (db) {
    db.close();
  }
}