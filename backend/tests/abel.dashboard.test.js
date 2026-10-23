const request = require('supertest');
const { createApp } = require('../src/app');
const { userDashboard } = require('../src/shared/contracts');
const { createStore } = require('../src/shared/store');

const users = {
  u1: { id: 'u1', name: 'First User', email: 'first@example.com', role: 'user' },
  u2: { id: 'u2', name: 'Second User', email: 'second@example.com', role: 'user' },
};
const services = [
  { id: 's1', name: 'Advising', description: 'Student support', expectedDurationMinutes: 10,
    priority: 'medium', isOpen: true },
  { id: 's2', name: 'IT Help Desk', description: 'Tech support', expectedDurationMinutes: 5,
    priority: 'high', isOpen: true },
];

function setup() {
  const store = createStore();
  services.forEach(service => store.services.set(service.id, { ...service }));
  // The test picks the caller with an x-test-user header; the real app never does this.
  const app = createApp({ store, resolveUser: async req => users[req.get('x-test-user')] ?? null });
  const as = id => ({
    get: path => request(app).get(`/api${path}`).set('x-test-user', id),
    post: path => request(app).post(`/api${path}`).set('x-test-user', id).send({}),
    delete: path => request(app).delete(`/api${path}`).set('x-test-user', id),
  });
  return { app, store, as };
}

test('GET /me/dashboard requires login', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/me/dashboard')).status).toBe(401);
});

test('a new user sees services and empty queues and notifications', async () => {
  const { as } = setup();
  const response = await as('u1').get('/me/dashboard');
  expect(response.status).toBe(200);
  expect(userDashboard.parse(response.body.data)).toEqual(response.body.data);
  expect(response.body.data.services.map(s => s.name)).toEqual(['Advising', 'IT Help Desk']);
  expect(response.body.data.queues).toEqual([]);
  expect(response.body.data.notifications).toEqual([]);
});

test('dashboard queue status matches the queue status endpoint', async () => {
  const { as } = setup();
  await as('u2').post('/services/s1/queue/join');
  await as('u1').post('/services/s1/queue/join');
  await as('u1').post('/services/s2/queue/join');
  const dashboard = (await as('u1').get('/me/dashboard')).body.data;
  expect(dashboard.queues).toHaveLength(2);
  const s1 = (await as('u1').get('/services/s1/queue/me')).body.data;
  const s2 = (await as('u1').get('/services/s2/queue/me')).body.data;
  expect(dashboard.queues).toEqual([s1, s2]);
  expect(s1).toMatchObject({ position: 2, estimatedWaitMinutes: 10 });
});

test('join, near, leave and serve flow fills notifications and history for each user only', async () => {
  const { as, store } = setup();
  await as('u1').post('/services/s1/queue/join');
  await as('u2').post('/services/s1/queue/join');
  await as('u1').delete('/services/s1/queue/me');

  const u1 = (await as('u1').get('/me/dashboard')).body.data;
  expect(u1.queues).toEqual([]);
  expect(u1.notifications.map(n => n.type).sort()).toEqual(['queue.joined', 'queue.left', 'queue.near']);
  const u1History = (await as('u1').get('/me/history')).body.data;
  expect(u1History).toHaveLength(1);
  expect(u1History[0]).toMatchObject({ serviceId: 's1', outcome: 'left' });

  const u2 = (await as('u2').get('/me/dashboard')).body.data;
  expect(u2.queues).toHaveLength(1);
  expect(u2.queues[0]).toMatchObject({ position: 1, estimatedWaitMinutes: 0 });
  expect(u2.notifications.every(n => n.userId === 'u2')).toBe(true);
  expect(u2.notifications.filter(n => n.type === 'queue.near')).toHaveLength(1);
  expect((await as('u2').get('/me/history')).body.data).toEqual([]);
  expect(store.history.size).toBe(1);
});

test('entries for a deleted service are left out of the dashboard', async () => {
  const { as, store } = setup();
  await as('u1').post('/services/s1/queue/join');
  store.services.delete('s1');
  const dashboard = (await as('u1').get('/me/dashboard')).body.data;
  expect(dashboard.queues).toEqual([]);
  expect(dashboard.services.map(s => s.id)).toEqual(['s2']);
});
