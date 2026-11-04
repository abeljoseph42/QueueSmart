const { createAuthService } = require('./auth.service');
const { createUserRepository } = require('./user.repository');
const { register } = require('../../shared/contracts');
const { ApiError } = require('../../shared/errors');

async function createDemoAdmin({ store, db, email, password }) {
  if (email === undefined && password === undefined) {
    return null;
  }

  const result = register.safeParse({
    name: 'Demo Administrator',
    email,
    password,
  });

  if (!result.success) {
    throw new Error(
      'Demo admin requires a valid email and a password of 8–128 characters.'
    );
  }

  if (db) {
    const existing = createUserRepository(db)
      .findByEmail(result.data.email);

    if (existing) {
      if (existing.role !== 'admin') {
        throw new ApiError(
          409,
          'EMAIL_IN_USE',
          'Admin email belongs to a regular account.'
        );
      }

      // Reuse the account without changing its password.
      return {
        id: existing.id,
        name: existing.name,
        email: existing.email,
        role: existing.role,
      };
    }
  }

  return createAuthService({ store, db })
    .registerAdmin(result.data);
}

module.exports = { createDemoAdmin };