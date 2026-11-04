const {
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual,
} = require('node:crypto');
const { promisify } = require('node:util');
const { ApiError } = require('../../shared/errors');
const { createUserRepository } = require('./user.repository');

const hashPassword = promisify(scrypt);

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function createAuthService({ store, db, now = Date.now }) {
  // The running server supplies SQLite.
  // Existing isolated tests can continue using their injected memory store.
  const users = db ? createUserRepository(db) : {
    findByEmail: email =>
      [...store.users.values()].find(
        user => user.email === email
      ),

    findById: id => store.users.get(id),

    insert: user => store.users.set(user.id, user),
  };

  const sessionDurationMs = 60 * 60 * 1000;

  async function createAccount({ name, email, password }, role) {
    const normalizedEmail = email.trim().toLowerCase();

    const emailExists = () =>
      Boolean(users.findByEmail(normalizedEmail));

    if (emailExists()) {
      throw new ApiError(
        409,
        'EMAIL_IN_USE',
        'An account with this email already exists.'
      );
    }

    const passwordSalt = randomBytes(16).toString('hex');

    const passwordHash = (
      await hashPassword(password, passwordSalt, 64)
    ).toString('hex');

    // Another registration may complete while hashing is in progress.
    if (emailExists()) {
      throw new ApiError(
        409,
        'EMAIL_IN_USE',
        'An account with this email already exists.'
      );
    }

    const user = {
      id: randomUUID(),
      name,
      email: normalizedEmail,
      role,
      passwordSalt,
      passwordHash,
    };

    users.insert(user);

    return publicUser(user);
  }

  async function login({ email, password }) {
    const user = users.findByEmail(
      email.trim().toLowerCase()
    );

    if (!user) {
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password.'
      );
    }

    const suppliedHash = await hashPassword(
      password,
      user.passwordSalt,
      64
    );

    const storedHash = Buffer.from(user.passwordHash, 'hex');

    const passwordMatches =
      suppliedHash.length === storedHash.length &&
      timingSafeEqual(suppliedHash, storedHash);

    if (!passwordMatches) {
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password.'
      );
    }

    const token = randomBytes(32).toString('hex');

    store.sessions.set(token, {
      userId: user.id,
      expiresAt: now() + sessionDurationMs,
    });

    return {
      user: publicUser(user),
      token,
    };
  }

  async function resolveUser(req) {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);

    if (!match) return null;

    const token = match[1];
    const session = store.sessions.get(token);

    if (!session) return null;

    if (session.expiresAt <= now()) {
      store.sessions.delete(token);
      return null;
    }

    const user = users.findById(session.userId);

    if (!user) {
      store.sessions.delete(token);
      return null;
    }

    return publicUser(user);
  }

  return {
    // Public registration always creates a regular user.
    register: input => createAccount(input, 'user'),

    // Internal bootstrap operation; no public route exposes this.
    registerAdmin: input => createAccount(input, 'admin'),

    login,
    resolveUser,
  };
}

module.exports = { createAuthService };