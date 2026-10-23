const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');

let store;
let publicApp;
let adminApp;
let userApp;

const serviceInput = {
  name: 'Academic Advising',
  description: 'Help with course planning',
  expectedDurationMinutes: 10,
  priority: 'medium',
};

beforeEach(() => {
  store = createStore();

  publicApp = createApp({ store });

  // Verified identities injected only into these test apps.
  adminApp = createApp({
    store,
    resolveUser: async () => ({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@example.com',
      role: 'admin',
    }),
  });

  userApp = createApp({
    store,
    resolveUser: async () => ({
      id: 'user-1',
      name: 'Test User',
      email: 'user@example.com',
      role: 'user',
    }),
  });
});

test('public callers can list an empty service collection', async () => {
  const response = await request(publicApp)
    .get('/api/services');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ data: [] });
});

test('an admin creates a service visible in public listing', async () => {
  const created = await request(adminApp)
    .post('/api/services')
    .send(serviceInput);

  expect(created.status).toBe(201);
  expect(created.body.data).toEqual({
    id: expect.any(String),
    ...serviceInput,
    isOpen: true,
  });

  const listed = await request(publicApp)
    .get('/api/services');

  expect(listed.status).toBe(200);
  expect(listed.body.data).toEqual([created.body.data]);
});

test('unauthenticated callers cannot create services', async () => {
  const response = await request(publicApp)
    .post('/api/services')
    .send(serviceInput);

  expect(response.status).toBe(401);
  expect(store.services.size).toBe(0);
});

test('regular users cannot create services', async () => {
  const response = await request(userApp)
    .post('/api/services')
    .send(serviceInput);

  expect(response.status).toBe(403);
  expect(store.services.size).toBe(0);
});

test('invalid service bodies are rejected without storing data', async () => {
  const invalidBodies = [
    { ...serviceInput, name: '' },
    { ...serviceInput, expectedDurationMinutes: '10' },
    { ...serviceInput, expectedDurationMinutes: 0 },
    { ...serviceInput, priority: 'urgent' },
    { ...serviceInput, isOpen: false },
    {},
  ];

  for (const body of invalidBodies) {
    const response = await request(adminApp)
      .post('/api/services')
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }

  expect(store.services.size).toBe(0);
});