const { createStore } = require('../src/shared/store');
const {
  createAuthService,
} = require('../src/modules/nik/auth.service');

let store;
let authService;

beforeEach(() => {
  store = createStore();
  authService = createAuthService({ store });
});

const registration = {
  name: 'Test User',
  email: 'user@example.com',
  password: 'test-password-123',
};

test('registers a user without exposing password fields', async () => {
  const user = await authService.register(registration);

  expect(user).toEqual({
    id: expect.any(String),
    name: registration.name,
    email: registration.email,
    role: 'user',
  });

  const stored = store.users.get(user.id);

  expect(stored.password).toBeUndefined();
  expect(stored.passwordHash).toEqual(expect.any(String));
  expect(stored.passwordHash).not.toBe(registration.password);
  expect(stored.passwordSalt).toEqual(expect.any(String));
});

test('rejects duplicate emails regardless of capitalization', async () => {
  await authService.register(registration);

  await expect(
    authService.register({
      ...registration,
      email: 'USER@example.com',
    })
  ).rejects.toMatchObject({
    status: 409,
    code: 'EMAIL_IN_USE',
  });

  expect(store.users.size).toBe(1);
});

test('does not accept an administrator role during registration', async () => {
  const user = await authService.register({
    ...registration,
    role: 'admin',
  });

  expect(user.role).toBe('user');
  expect(store.users.get(user.id).role).toBe('user');
});

test('allows only one concurrent registration for an email', async () => {
  const results = await Promise.allSettled([
    authService.register(registration),
    authService.register(registration),
  ]);

  expect(
    results.filter(result => result.status === 'fulfilled')
  ).toHaveLength(1);

  expect(
    results.filter(result => result.status === 'rejected')
  ).toHaveLength(1);

  expect(store.users.size).toBe(1);
});

function requestWithToken(token) {
  return {
    get: header =>
      header === 'authorization' ? `Bearer ${token}` : undefined,
  };
}

test('logs in and creates a session', async () => {
  const registered = await authService.register(registration);
  const result = await authService.login(registration);

  expect(result.user).toEqual(registered);
  expect(result.token).toMatch(/^[a-f0-9]{64}$/);

  expect(store.sessions.get(result.token)).toEqual({
    userId: registered.id,
    expiresAt: expect.any(Number),
  });
});

test('rejects an incorrect password without creating a session', async () => {
  await authService.register(registration);

  await expect(
    authService.login({
      ...registration,
      password: 'incorrect-password',
    })
  ).rejects.toMatchObject({
    status: 401,
    code: 'INVALID_CREDENTIALS',
  });

  expect(store.sessions.size).toBe(0);
});

test('rejects an unknown email', async () => {
  await expect(
    authService.login(registration)
  ).rejects.toMatchObject({
    status: 401,
    code: 'INVALID_CREDENTIALS',
  });
});

test('resolves a valid session to its public user', async () => {
  const registered = await authService.register(registration);
  const { token } = await authService.login(registration);

  const user = await authService.resolveUser(
    requestWithToken(token)
  );

  expect(user).toEqual(registered);
  expect(user.passwordHash).toBeUndefined();
});

test('rejects missing and unknown bearer tokens', async () => {
  expect(
    await authService.resolveUser({ get: () => undefined })
  ).toBeNull();

  expect(
    await authService.resolveUser(
      requestWithToken('a'.repeat(64))
    )
  ).toBeNull();
});

test('expires sessions after one hour', async () => {
  let currentTime = 1000;

  const service = createAuthService({
    store,
    now: () => currentTime,
  });

  await service.register(registration);
  const { token } = await service.login(registration);

  currentTime += 60 * 60 * 1000;

  expect(
    await service.resolveUser(requestWithToken(token))
  ).toBeNull();

  expect(store.sessions.has(token)).toBe(false);
});

test('rejects a session if its user no longer exists', async () => {
  const registered = await authService.register(registration);
  const { token } = await authService.login(registration);

  store.users.delete(registered.id);

  expect(
    await authService.resolveUser(requestWithToken(token))
  ).toBeNull();

  expect(store.sessions.has(token)).toBe(false);
});