const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');
const c = require('../src/shared/contracts');

const users = {
  u1: { id: 'u1', name: 'User One', email: 'one@example.com', role: 'user' },
  u2: { id: 'u2', name: 'User Two', email: 'two@example.com', role: 'user' },
};
const advising = { id: 's1', name: 'Academic Advising', description: 'Course planning help',
  expectedDurationMinutes: 15, priority: 'high', isOpen: true };
const support = { id: 's2', name: 'Technical Support', description: 'Account and device help',
  expectedDurationMinutes: 10, priority: 'medium', isOpen: true };
const closed = { id: 's3', name: 'Student Services', description: 'General questions',
  expectedDurationMinutes: 10, priority: 'low', isOpen: false };

function setup() {
  const store = createStore();
  for (const service of [advising, support, closed]) store.services.set(service.id, { ...service });
  const events = createEventBus();
  const joined = jest.fn();
  events.subscribe(EVENTS.JOINED, joined);
  let current = users.u1;
  const app = createApp({ store, events, resolveUser: async () => current });
  const as = userId => { current = users[userId]; return request(app); };
  return { store, joined, as };
}

describe('POST /services/:serviceId/queue/join', () => {
  test('joins an open queue and returns a valid queueStatus', async () => {
    const { store, joined, as } = setup();
    const res = await as('u1').post('/api/services/s1/queue/join').send({});
    expect(res.status).toBe(201);
    expect(c.queueStatus.parse(res.body.data)).toEqual(res.body.data);
    const { entry, position, estimatedWaitMinutes } = res.body.data;
    expect(entry).toMatchObject({ serviceId: 's1', userId: 'u1', priority: 'high', status: 'waiting' });
    expect(position).toBe(1);
    expect(estimatedWaitMinutes).toBe(0);
    expect(store.queueEntries.get(entry.id)).toEqual(entry);
    expect(joined).toHaveBeenCalledTimes(1);
    expect(joined).toHaveBeenCalledWith({ entry });
  });

  test('second user is placed behind the first with a wait estimate', async () => {
    const { as } = setup();
    await as('u1').post('/api/services/s1/queue/join').send({});
    const res = await as('u2').post('/api/services/s1/queue/join').send({});
    expect(res.body.data.position).toBe(2);
    expect(res.body.data.estimatedWaitMinutes).toBe(15);
  });

  test('rejects a duplicate active entry for the same service with 409', async () => {
    const { store, joined, as } = setup();
    await as('u1').post('/api/services/s1/queue/join').send({});
    const res = await as('u1').post('/api/services/s1/queue/join').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_IN_QUEUE');
    expect(store.queueEntries.size).toBe(1);
    expect(joined).toHaveBeenCalledTimes(1); 
  });

  test('one user can wait in different services at the same time', async () => {
    const { store, as } = setup();
    expect((await as('u1').post('/api/services/s1/queue/join').send({})).status).toBe(201);
    expect((await as('u1').post('/api/services/s2/queue/join').send({})).status).toBe(201);
    expect(store.queueEntries.size).toBe(2);
  });

  test('rejoining after a terminal outcome creates a new entry', async () => {
    const { store, as } = setup();
    const first = (await as('u1').post('/api/services/s1/queue/join').send({})).body.data.entry;
    store.queueEntries.get(first.id).status = 'served';
    const res = await as('u1').post('/api/services/s1/queue/join').send({});
    expect(res.status).toBe(201);
    expect(res.body.data.entry.id).not.toBe(first.id);
    expect(res.body.data.position).toBe(1);
  });

  test('closed queue rejects new joins with 409', async () => {
    const { store, joined, as } = setup();
    const res = await as('u1').post('/api/services/s3/queue/join').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEUE_CLOSED');
    expect(store.queueEntries.size).toBe(0);
    expect(joined).not.toHaveBeenCalled();
  });

  test('unknown service returns 404', async () => {
    const { as } = setup();
    const res = await as('u1').post('/api/services/nope/queue/join').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('caller cannot choose identity or priority', async () => {
    const { store, as } = setup();
    const res = await as('u1').post('/api/services/s1/queue/join').send({ userId: 'u2', priority: 'low' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.queueEntries.size).toBe(0);
  });

  test('unauthenticated callers receive 401', async () => {
    const app = createApp();
    expect((await request(app).post('/api/services/s1/queue/join').send({})).status).toBe(401);
  });
});