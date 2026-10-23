const request = require('supertest');
const { createApp } = require('../src/app');
const { historyRecord } = require('../src/shared/contracts');
const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');
const { initQueueSubscribers } = require('../src/modules/abel/subscribers');
const { listHistory } = require('../src/modules/abel/history');

const entry = { id: 'e1', userId: 'u1', serviceId: 's1', priority: 'medium',
  joinedAt: '2026-10-22T12:00:00.000Z', status: 'waiting' };
const user = { id: 'u1', name: 'Test User', email: 'user@example.com', role: 'user' };

let store, events, cleanup;
beforeEach(() => {
  store = createStore();
  events = createEventBus();
  cleanup = initQueueSubscribers({ store, events });
});
afterEach(() => cleanup());

test.each([
  [EVENTS.SERVED, 'served'], [EVENTS.LEFT, 'left'], [EVENTS.REMOVED, 'removed'],
])('%s creates one history record with outcome %s', (event, outcome) => {
  events.publish(event, { entry: { ...entry, status: outcome } });
  const records = listHistory(store, 'u1');
  expect(records).toHaveLength(1);
  expect(historyRecord.parse(records[0])).toEqual(records[0]);
  expect(records[0]).toMatchObject({ entryId: 'e1', serviceId: 's1',
    joinedAt: entry.joinedAt, outcome });
});

test('joining and near events do not create history', () => {
  events.publish(EVENTS.JOINED, { entry });
  events.publish(EVENTS.NEAR, { entry });
  expect(store.history.size).toBe(0);
});

test('an entry gets only one history record', () => {
  events.publish(EVENTS.SERVED, { entry: { ...entry, status: 'served' } });
  events.publish(EVENTS.SERVED, { entry: { ...entry, status: 'served' } });
  events.publish(EVENTS.REMOVED, { entry: { ...entry, status: 'removed' } });
  expect(listHistory(store, 'u1').map(r => r.outcome)).toEqual(['served']);
});

test('rejoining creates a new entry with its own history record', () => {
  events.publish(EVENTS.LEFT, { entry: { ...entry, status: 'left' } });
  events.publish(EVENTS.SERVED, { entry: { ...entry, id: 'e2', status: 'served' } });
  expect(store.history.size).toBe(2);
});

test('listing returns only that user\'s history, most recent first', () => {
  store.history.set('h1', { id: 'h1', userId: 'u1', endedAt: '2026-10-22T12:00:00.000Z' });
  store.history.set('h2', { id: 'h2', userId: 'u2', endedAt: '2026-10-22T12:05:00.000Z' });
  store.history.set('h3', { id: 'h3', userId: 'u1', endedAt: '2026-10-22T12:10:00.000Z' });
  expect(listHistory(store, 'u1').map(r => r.id)).toEqual(['h3', 'h1']);
});

test('GET /me/history requires login and returns only the caller\'s history', async () => {
  events.publish(EVENTS.SERVED, { entry: { ...entry, status: 'served' } });
  events.publish(EVENTS.LEFT, { entry: { ...entry, id: 'e2', userId: 'u2', status: 'left' } });
  expect((await request(createApp({ store })).get('/api/me/history')).status).toBe(401);
  const app = createApp({ store, resolveUser: async () => user });
  const response = await request(app).get('/api/me/history');
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0]).toMatchObject({ userId: 'u1', outcome: 'served' });
});

test('GET /me/history returns an empty list for a new user', async () => {
  const app = createApp({ resolveUser: async () => user });
  expect((await request(app).get('/api/me/history')).body).toEqual({ data: [] });
});
