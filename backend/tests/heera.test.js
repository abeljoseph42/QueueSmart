const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const user = { id: 'u1', name: 'Test User', email: 'user@example.com', role: 'user' };
const as = (role, store) => createApp({ store, resolveUser: async () => ({ ...user, role }) });
const service = (id, isOpen, expectedDurationMinutes = 10) =>
  ({ id, name: `Service ${id}`, description: 'Desk', expectedDurationMinutes, priority: 'medium', isOpen });
const entry = (id, serviceId, priority, joinedAt, status = 'waiting') =>
  ({ id, serviceId, userId: `u-${id}`, priority, joinedAt, status });
function seed() {
  const store = createStore();
  [service('s1', true, 15), service('s2', false), service('s3', true)].forEach(s => store.services.set(s.id, s));
  [
    entry('e1', 's1', 'low', '2026-10-01T09:00:00.000Z'),
    entry('e2', 's1', 'high', '2026-10-01T09:05:00.000Z'),
    entry('e3', 's1', 'medium', '2026-10-01T09:01:00.000Z'),
    entry('e4', 's1', 'high', '2026-10-01T09:02:00.000Z'),
    entry('e5', 's1', 'high', '2026-10-01T08:00:00.000Z', 'served'),
    entry('e6', 's1', 'high', '2026-10-01T08:01:00.000Z', 'left'),
    entry('e7', 's2', 'high', '2026-10-01T08:02:00.000Z', 'removed'),
    entry('e8', 's2', 'low', '2026-10-01T09:00:00.000Z'),
  ].forEach(e => store.queueEntries.set(e.id, e));
  return store;
}
const routes = ['/api/admin/dashboard', '/api/admin/services/s1/queue'];

test.each(routes)('%s requires an admin identity', async path => {
  expect((await request(createApp({ store: seed() })).get(path)).status).toBe(401);
  const response = await request(as('user', seed())).get(path);
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('FORBIDDEN');
});

test('dashboard counts services, open services, and waiting entries only', async () => {
  const response = await request(as('admin', seed())).get('/api/admin/dashboard');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ data: { serviceCount: 3, waitingCount: 5, openServiceCount: 2 } });
});

test('dashboard reports zeros for an empty store', async () => {
  const response = await request(as('admin', createStore())).get('/api/admin/dashboard');
  expect(response.body).toEqual({ data: { serviceCount: 0, waitingCount: 0, openServiceCount: 0 } });
});

test('queue lists waiting entries by priority then arrival, with positions and waits', async () => {
  const store = seed();
  store.queueEntries.get('e2').internalNote = 'hidden';
  const response = await request(as('admin', store)).get('/api/admin/services/s1/queue');
  expect(response.status).toBe(200);
  expect(response.body.data.map(s => [s.entry.id, s.position, s.estimatedWaitMinutes]))
    .toEqual([['e4', 1, 0], ['e2', 2, 15], ['e3', 3, 30], ['e1', 4, 45]]);
  expect(response.body.data[1].entry).toEqual(entry('e2', 's1', 'high', '2026-10-01T09:05:00.000Z'));
});

test('queue breaks identical priority and arrival ties by id', async () => {
  const store = seed();
  store.queueEntries.set('e0', entry('e0', 's1', 'high', '2026-10-01T09:02:00.000Z'));
  const response = await request(as('admin', store)).get('/api/admin/services/s1/queue');
  expect(response.body.data.slice(0, 2).map(s => s.entry.id)).toEqual(['e0', 'e4']);
});

test('queue returns 404 for an unknown service and [] for an empty queue', async () => {
  const missing = await request(as('admin', seed())).get('/api/admin/services/nope/queue');
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe('NOT_FOUND');
  const empty = await request(as('admin', seed())).get('/api/admin/services/s3/queue');
  expect(empty.status).toBe(200);
  expect(empty.body).toEqual({ data: [] });
});

const toggle = (app, serviceId, body) => request(app).patch(`/api/admin/services/${serviceId}/queue`).send(body);

test('PATCH queue requires an admin identity', async () => {
  expect((await toggle(createApp({ store: seed() }), 's1', { isOpen: false })).status).toBe(401);
  expect((await toggle(as('user', seed()), 's1', { isOpen: false })).status).toBe(403);
});

test('closing an open service updates only isOpen and keeps waiting entries', async () => {
  const store = seed();
  const app = as('admin', store);
  const before = { ...store.services.get('s1') };
  const response = await toggle(app, 's1', { isOpen: false });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ data: { ...before, isOpen: false } });
  expect(store.services.get('s1')).toEqual({ ...before, isOpen: false });
  const queue = await request(app).get('/api/admin/services/s1/queue');
  expect(queue.body.data.map(s => s.entry.id)).toEqual(['e4', 'e2', 'e3', 'e1']);
  expect((await request(app).get('/api/admin/dashboard')).body.data)
    .toEqual({ serviceCount: 3, waitingCount: 5, openServiceCount: 1 });
});

test('reopening a closed service', async () => {
  const store = seed();
  const app = as('admin', store);
  const response = await toggle(app, 's2', { isOpen: true });
  expect(response.status).toBe(200);
  expect(response.body.data.isOpen).toBe(true);
  expect(store.services.get('s2').isOpen).toBe(true);
  expect((await request(app).get('/api/admin/dashboard')).body.data.openServiceCount).toBe(3);
});

test('PATCH queue rejects unknown services and invalid bodies', async () => {
  const app = as('admin', seed());
  const missing = await toggle(app, 'nope', { isOpen: false });
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe('NOT_FOUND');
  for (const body of [{}, { isOpen: 'yes' }, { isOpen: false, name: 'x' }]) {
    const response = await toggle(app, 's1', body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  }
});

const { EVENTS, createEventBus } = require('../src/shared/events');
function served(store) {
  const events = createEventBus();
  const log = [];
  Object.values(EVENTS).forEach(name => events.subscribe(name, payload => log.push([name, payload.entry])));
  const app = createApp({ store, events, resolveUser: async () => ({ ...user, role: 'admin' }) });
  return { app, log, serve: serviceId => request(app).post(`/api/admin/services/${serviceId}/queue/serve-next`) };
}

test('serve-next requires an admin identity', async () => {
  const path = '/api/admin/services/s1/queue/serve-next';
  expect((await request(createApp({ store: seed() })).post(path)).status).toBe(401);
  expect((await request(as('user', seed())).post(path)).status).toBe(403);
});

test('serve-next serves the first entry, shifts the queue, and publishes events', async () => {
  const store = seed();
  const { app, log, serve } = served(store);
  const response = await serve('s1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ data: { entry: { ...entry('e4', 's1', 'high', '2026-10-01T09:02:00.000Z'), status: 'served' } } });
  expect(store.queueEntries.get('e4').status).toBe('served');
  const queue = await request(app).get('/api/admin/services/s1/queue');
  expect(queue.body.data.map(s => [s.entry.id, s.position, s.estimatedWaitMinutes]))
    .toEqual([['e2', 1, 0], ['e3', 2, 15], ['e1', 3, 30]]);
  expect(JSON.stringify(queue.body)).not.toContain('nearNotifiedAt');
  expect((await request(app).get('/api/admin/dashboard')).body.data.waitingCount).toBe(4);
  expect(log.filter(([name]) => name === EVENTS.SERVED)).toEqual([[EVENTS.SERVED, response.body.data.entry]]);
  expect(log.map(([name, e]) => [name, e.id])).toEqual([[EVENTS.SERVED, 'e4'], [EVENTS.NEAR, 'e2'], [EVENTS.NEAR, 'e3']]);
  expect(store.queueEntries.get('e2').nearNotifiedAt).toEqual(expect.any(String));
});

test('near events fire once per entry across serves and never leak the marker', async () => {
  const store = seed();
  const { log, serve } = served(store);
  await serve('s1');
  const second = await serve('s1');
  expect(second.body.data.entry.id).toBe('e2');
  expect(JSON.stringify(second.body)).not.toContain('nearNotifiedAt');
  expect(log.filter(([name]) => name === EVENTS.NEAR).map(([, e]) => e.id)).toEqual(['e2', 'e3', 'e1']);
  log.forEach(([, e]) => expect(e).not.toHaveProperty('nearNotifiedAt'));
});

test('serve-next rejects empty queues and unknown services without events', async () => {
  const { log, serve } = served(seed());
  const empty = await serve('s3');
  expect(empty.status).toBe(409);
  expect(empty.body.error).toEqual({ code: 'CONFLICT', message: 'Queue is empty.' });
  const missing = await serve('nope');
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe('NOT_FOUND');
  expect(log).toEqual([]);
});

test('serve-next works on a closed service', async () => {
  const store = seed();
  const { serve } = served(store);
  const response = await serve('s2');
  expect(response.status).toBe(200);
  expect(response.body.data.entry.id).toBe('e8');
  expect(store.queueEntries.get('e8').status).toBe('served');
});
