const {
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual,
} = require('node:crypto');
const { promisify } = require('node:util');
const { ApiError } = require('../../shared/errors');

const hashPassword = promisify(scrypt);

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function createAuthService({ store, now = Date.now }) {
  const sessionDurationMs = 60 * 60 * 1000;
  async function register({ name, email, password }) {
    const normalizedEmail = email.toLowerCase();

    const emailExists = () =>
      [...store.users.values()].some(
        user => user.email === normalizedEmail
      );

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

    // Another registration may finish while hashing is in progress.
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
      role: 'user',
      passwordSalt,
      passwordHash,
    };

    store.users.set(user.id, user);

    return publicUser(user);
  }

    async function login({ email, password }) {
    const user = [...store.users.values()].find(
      candidate => candidate.email === email.toLowerCase()
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

    const user = store.users.get(session.userId);

    if (!user) {
      store.sessions.delete(token);
      return null;
    }

    return publicUser(user);
  }

  return { register, login, resolveUser };
}

module.exports = { createAuthService };