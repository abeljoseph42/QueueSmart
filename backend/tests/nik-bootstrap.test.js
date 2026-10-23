const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const {
  createAuthService,
} = require('../src/modules/nik/auth.service');
const {
  createDemoAdmin,
} = require('../src/modules/nik/bootstrap');

let store;

beforeEach(() => {
  store = createStore();
});

test('does not create an admin without configuration', async () => {
  const result = await createDemoAdmin({ store });

  expect(result).toBeNull();
  expect(store.users.size).toBe(0);
});

test('creates a configured admin who can log in', async () => {
  const credentials = {
    email: 'admin@example.com',
    password: 'demo-password-123',
  };

  const admin = await createDemoAdmin({
    store,
    ...credentials,
  });

  expect(admin.role).toBe('admin');
  expect(store.users.get(admin.id).role).toBe('admin');
  expect(admin.passwordHash).toBeUndefined();

  const authService = createAuthService({ store });
  const login = await authService.login(credentials);

  expect(login.user.role).toBe('admin');
  expect(login.token).toEqual(expect.any(String));
});

test('rejects incomplete or invalid configuration', async () => {
  const invalidConfigurations = [
    { email: 'admin@example.com' },
    { password: 'demo-password-123' },
    { email: 'invalid', password: 'demo-password-123' },
    { email: 'admin@example.com', password: 'short' },
  ];

  for (const configuration of invalidConfigurations) {
    await expect(
      createDemoAdmin({ store, ...configuration })
    ).rejects.toThrow('Demo admin requires');
  }

  expect(store.users.size).toBe(0);
});

test('does not promote an existing regular account', async () => {
  const authService = createAuthService({ store });

  const user = await authService.register({
    name: 'Regular User',
    email: 'user@example.com',
    password: 'regular-password-123',
  });

  await expect(
    createDemoAdmin({
      store,
      email: 'user@example.com',
      password: 'different-password-123',
    })
  ).rejects.toMatchObject({
    status: 409,
    code: 'EMAIL_IN_USE',
  });

  expect(store.users.get(user.id).role).toBe('user');
});

test('the configured admin can log in through the API and create a service', async () => {
  const credentials = {
    email: 'admin@example.com',
    password: 'demo-password-123',
  };

  await createDemoAdmin({
    store,
    ...credentials,
  });

  const app = createApp({ store });

  const login = await request(app)
    .post('/api/auth/login')
    .send(credentials);

  expect(login.status).toBe(200);
  expect(login.body.data.user.role).toBe('admin');

  const created = await request(app)
    .post('/api/services')
    .set(
      'Authorization',
      `Bearer ${login.body.data.token}`
    )
    .send({
      name: 'Academic Advising',
      description: 'Help with course planning',
      expectedDurationMinutes: 10,
      priority: 'medium',
    });

  expect(created.status).toBe(201);
  expect(created.body.data.name).toBe('Academic Advising');
});