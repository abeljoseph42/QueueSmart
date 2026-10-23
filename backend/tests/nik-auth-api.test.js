const request = require('supertest');
const { createApp } = require('../src/app');

let app;

const registration = {
  name: 'Test User',
  email: 'user@example.com',
  password: 'test-password-123',
};

beforeEach(() => {
  app = createApp();
});

test('registration returns a public user and usable token', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send(registration);

  expect(response.status).toBe(201);

  const { user, token } = response.body.data;

  expect(user).toEqual({
    id: expect.any(String),
    name: registration.name,
    email: registration.email,
    role: 'user',
  });

  expect(token).toMatch(/^[a-f0-9]{64}$/);

  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`);

  expect(me.status).toBe(200);
  expect(me.body.data).toEqual(user);
});

test('login returns a token that authenticates the user', async () => {
  await request(app)
    .post('/api/auth/register')
    .send(registration);

  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: registration.email,
      password: registration.password,
    });

  expect(response.status).toBe(200);

  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${response.body.data.token}`);

  expect(me.status).toBe(200);
  expect(me.body.data.email).toBe(registration.email);
});

test('duplicate registration returns 409', async () => {
  await request(app)
    .post('/api/auth/register')
    .send(registration);

  const response = await request(app)
    .post('/api/auth/register')
    .send({
      ...registration,
      email: 'USER@example.com',
    });

  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('EMAIL_IN_USE');
});

test('wrong credentials return 401', async () => {
  await request(app)
    .post('/api/auth/register')
    .send(registration);

  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: registration.email,
      password: 'incorrect-password',
    });

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
});

test('an unknown bearer token cannot authenticate', async () => {
  const response = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${'a'.repeat(64)}`);

  expect(response.status).toBe(401);
});

test('a registered user cannot create services', async () => {
  const registrationResponse = await request(app)
    .post('/api/auth/register')
    .send(registration);

  const response = await request(app)
    .post('/api/services')
    .set(
      'Authorization',
      `Bearer ${registrationResponse.body.data.token}`
    )
    .send({
      name: 'Academic Advising',
      description: 'Student advising appointments',
      expectedDurationMinutes: 10,
      priority: 'medium',
    });

  expect(response.status).toBe(403);
});