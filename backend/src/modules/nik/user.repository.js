const {
  withWriteTransaction,
} = require('../../database/connection');
const { ApiError } = require('../../shared/errors');

function createUserRepository(db) {
  const select = `
    SELECT
      c.id,
      c.email,
      c.password_hash,
      c.role,
      p.full_name
    FROM user_credentials c
    JOIN user_profile p ON p.email = c.email
  `;

  function toUser(row) {
    if (!row) return undefined;

    const hash = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/
      .exec(row.password_hash);

    if (!hash) {
      throw new Error('Unsupported stored password hash.');
    }

    return {
      id: row.id,
      name: row.full_name,
      email: row.email,
      role: row.role === 'Administrator' ? 'admin' : 'user',
      passwordSalt: hash[1],
      passwordHash: hash[2],
    };
  }

  function insert(user) {
    try {
      withWriteTransaction(db, () => {
        db.prepare(`
          INSERT INTO user_credentials (
            id, email, password_hash, role
          )
          VALUES (?, ?, ?, ?)
        `).run(
          user.id,
          user.email,
          `scrypt$${user.passwordSalt}$${user.passwordHash}`,
          user.role === 'admin' ? 'Administrator' : 'User'
        );

        db.prepare(`
          INSERT INTO user_profile (email, full_name)
          VALUES (?, ?)
        `).run(user.email, user.name);
      });
    } catch (error) {
      // SQLite's unique constraint handles competing registrations.
      if (error.errcode === 2067) {
        throw new ApiError(
          409,
          'EMAIL_IN_USE',
          'An account with this email already exists.'
        );
      }

      throw error;
    }
  }

  return {
    insert,

    findByEmail: email =>
      toUser(
        db.prepare(`${select} WHERE c.email = ?`).get(email)
      ),

    findById: id =>
      toUser(
        db.prepare(`${select} WHERE c.id = ?`).get(id)
      ),
  };
}

module.exports = { createUserRepository };