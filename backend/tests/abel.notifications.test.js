const request = require('supertest');
const { createApp } = require('../src/app');
const { notification } = require('../src/shared/contracts');
const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');
const { initQueueSubscribers } = require('../src/modules/abel/subscribers');
const { listNotifications } = require('../src/modules/abel/notifications');

const entry = { id: 'e1', userId: 'u1', serviceId: 's1', priority: 'medium',
  joinedAt: '2026-10-22T12:00:00.000Z', status: 'waiting' };
const user = { id: 'u1', name: 'Test User', email: 'user@example.com', role: 'user' };

let store, events, cleanup;
beforeEach(() => {
  store = createStore();
  events = createEventBus();
  store.services.set('s1', { id: 's1', name: 'Advising' });
  cleanup = initQueueSubscribers({ store, events });
});
afterEach(() => cleanup());

test('joining creates a notification for that user', () => {
  events.publish(EVENTS.JOINED, { entry });
  const [created] = listNotifications(store, 'u1');
  expect(notification.parse(created)).toEqual(created);
  expect(created).toMatchObject({ userId: 'u1', entryId: 'e1', type: 'queue.joined',
    message: 'You joined the Advising queue.' });
});

test('near and terminal events each create their own notification', () => {
  events.publish(EVENTS.NEAR, { entry });
  events.publish(EVENTS.SERVED, { entry: { ...entry, status: 'served' } });
  events.publish(EVENTS.LEFT, { entry: { ...entry, id: 'e2', status: 'left' } });
  events.publish(EVENTS.REMOVED, { entry: { ...entry, id: 'e3', status: 'removed' } });
  const types = listNotifications(store, 'u1').map(n => n.type).sort();
  expect(types).toEqual(['queue.left', 'queue.near', 'queue.removed', 'queue.served']);
});

test('repeated events for the same entry do not duplicate notifications', () => {
  events.publish(EVENTS.NEAR, { entry });
  events.publish(EVENTS.NEAR, { entry });
  events.publish(EVENTS.JOINED, { entry });
  events.publish(EVENTS.JOINED, { entry });
  expect(store.notifications.size).toBe(2);
});

test('unknown services fall back to a generic name and payloads are not changed', () => {
  const payload = { entry: { ...entry, serviceId: 'missing' } };
  const before = structuredClone(payload);
  events.publish(EVENTS.JOINED, payload);
  expect(listNotifications(store, 'u1')[0].message).toBe('You joined the service queue.');
  expect(payload).toEqual(before);
});

test('listing returns only that user\'s notifications, newest first', () => {
  store.notifications.set('n1', { id: 'n1', userId: 'u1', createdAt: '2026-10-22T12:00:00.000Z' });
  store.notifications.set('n2', { id: 'n2', userId: 'u2', createdAt: '2026-10-22T12:05:00.000Z' });
  store.notifications.set('n3', { id: 'n3', userId: 'u1', createdAt: '2026-10-22T12:10:00.000Z' });
  expect(listNotifications(store, 'u1').map(n => n.id)).toEqual(['n3', 'n1']);
});

test('GET /me/notifications requires login and returns only the caller\'s notifications', async () => {
  events.publish(EVENTS.JOINED, { entry });
  events.publish(EVENTS.JOINED, { entry: { ...entry, id: 'e2', userId: 'u2' } });
  expect((await request(createApp({ store })).get('/api/me/notifications')).status).toBe(401);
  const app = createApp({ store, resolveUser: async () => user });
  const response = await request(app).get('/api/me/notifications');
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0]).toMatchObject({ userId: 'u1', entryId: 'e1' });
});

test('GET /me/notifications returns an empty list for a new user', async () => {
  const app = createApp({ resolveUser: async () => user });
  const response = await request(app).get('/api/me/notifications');
  expect(response.body).toEqual({ data: [] });
});
