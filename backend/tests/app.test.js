const request = require('supertest');
const { createApp } = require('../src/app');
const user = { id: 'u1', name: 'Test User', email: 'user@example.com', role: 'user' };
const as = role => createApp({ resolveUser: async () => ({ ...user, role }) });
const validService = { name: 'Advising', description: 'Student support', expectedDurationMinutes: 10, priority: 'medium' };

test('health, configured CORS, and missing route', async () => {
  const app = createApp({ frontendOrigin: 'http://localhost:5173' });
  const health = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
  expect(health.status).toBe(200);
  expect(health.body).toEqual({ data: { status: 'ok' } });
  expect(health.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  expect((await request(app).get('/missing')).body.error.code).toBe('NOT_FOUND');
});

test('invalid JSON and oversized bodies produce consistent errors', async () => {
  const app = createApp();
  const invalid = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{');
  expect(invalid.status).toBe(400);
  expect(invalid.body.error.code).toBe('INVALID_JSON');
  const large = await request(app).post('/api/auth/login').send({ password: 'x'.repeat(20000) });
  expect(large.status).toBe(413);
});

test('registration validates fields and prevents role injection', async () => {
  const app = createApp();
  const data = { name: 'Nik', email: 'nik@example.com', password: 'longpassword' };
  expect((await request(app).post('/api/auth/register').send(data)).status).toBe(501);
  const bad = await request(app).post('/api/auth/register').send({ ...data, role: 'admin' });
  expect(bad.status).toBe(400);
  expect(bad.body.error.details).toEqual(expect.any(Array));
  expect((await request(app).post('/api/auth/login').send({ email: 'no', password: 'short' })).status).toBe(400);
  expect((await request(app).post('/api/auth/login').send({ email: data.email, password: data.password })).status).toBe(501);
});

test('auth fails closed and ignores browser identity headers', async () => {
  const response = await request(createApp()).get('/api/auth/me').set('X-User-Id', 'u1').set('X-Role', 'admin');
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('UNAUTHENTICATED');
  const me = await request(as('user')).get('/api/auth/me');
  expect(me.body).toEqual({ data: user });
});

test('resolver failures are sanitized', async () => {
  for (const resolveUser of [async () => { throw new Error('secret'); }, async () => ({ id: 'u1', role: 'root' })]) {
    const response = await request(createApp({ resolveUser })).get('/api/auth/me');
    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  }
});

test('service writes require admin before validation', async () => {
  expect((await request(createApp()).post('/api/services').send(validService)).status).toBe(401);
  expect((await request(as('user')).post('/api/services').send(validService)).status).toBe(403);
  expect((await request(as('admin')).post('/api/services').send(validService)).status).toBe(501);
  expect((await request(as('admin')).post('/api/services').send({ ...validService, expectedDurationMinutes: '10' })).status).toBe(400);
  expect((await request(as('admin')).patch('/api/services/s1').send({})).status).toBe(400);
  expect((await request(as('admin')).patch('/api/services/s1').send({ name: 'New name' })).status).toBe(501);
});

const userRoutes = [
  ['get', '/me/dashboard'], ['get', '/me/history'], ['get', '/me/notifications'],
  ['post', '/services/s1/queue/join', {}], ['delete', '/services/s1/queue/me'], ['get', '/services/s1/queue/me'],
];
test.each(userRoutes.map(([method, path, body]) => ({ method, path, body })))
  ('$method $path is protected and explicitly unfinished', async ({ method, path, body }) => {
  expect((await request(createApp())[method](`/api${path}`).send(body)).status).toBe(401);
  const response = await request(as('user'))[method](`/api${path}`).send(body);
  expect(response.status).toBe(501);
  expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
});
const adminRoutes = [
  ['get', '/admin/dashboard'], ['get', '/admin/services/s1/queue'],
  ['patch', '/admin/services/s1/queue', { isOpen: true }],
  ['post', '/admin/services/s1/queue/serve-next'],
  ['patch', '/admin/services/s1/queue/e1', { position: 2 }],
  ['delete', '/admin/services/s1/queue/e1'],
];
test.each(adminRoutes.map(([method, path, body]) => ({ method, path, body })))
  ('$method $path enforces admin role', async ({ method, path, body }) => {
  expect((await request(as('user'))[method](`/api${path}`).send(body)).status).toBe(403);
});
test('public service stub and rejected caller-assigned queue priority', async () => {
  expect((await request(createApp()).get('/api/services')).status).toBe(501);
  const response = await request(as('user')).post('/api/services/s1/queue/join').send({ priority: 'high', userId: 'other' });
  expect(response.status).toBe(400);
});
