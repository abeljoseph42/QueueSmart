const { createAuthService } = require('./auth.service');
const { register } = require('../../shared/contracts');

async function createDemoAdmin({ store, email, password }) {
  // No demo account unless explicitly configured.
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

  const authService = createAuthService({ store });
  const user = await authService.register(result.data);

  const storedUser = store.users.get(user.id);
  storedUser.role = 'admin';

  return {
    ...user,
    role: 'admin',
  };
}

module.exports = { createDemoAdmin };