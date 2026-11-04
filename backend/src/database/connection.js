const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { ApiError } = require('../shared/errors');

const BACKEND_ROOT = path.resolve(__dirname, '../..');

function openDatabase({
  filename = process.env.QUEUESMART_DB_PATH || 'data/queuesmart.sqlite',
} = {}) {
  // Relative paths always resolve from backend/, regardless of terminal location.
  const resolved = path.resolve(BACKEND_ROOT, filename);

  mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new DatabaseSync(resolved);

  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
    `);

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function withWriteTransaction(db, callback) {
  let started = false;

  try {
    // Acquire the write transaction before reading data used to validate a write.
    db.exec('BEGIN IMMEDIATE');
    started = true;

    // Callbacks must be synchronous. Email delivery happens after commit.
    const result = callback(db);

    if (result && typeof result.then === 'function') {
      throw new TypeError(
        'Database transaction callbacks must be synchronous.'
      );
    }

    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (started) {
      db.exec('ROLLBACK');
    }

    // SQLite BUSY and LOCKED errors become a safe API response.
    if (
      Number.isInteger(error.errcode) &&
      [5, 6].includes(error.errcode & 255)
    ) {
      throw new ApiError(
        503,
        'DATABASE_BUSY',
        'Database is busy. Please try again.'
      );
    }

    throw error;
  }
}

module.exports = { openDatabase, withWriteTransaction };