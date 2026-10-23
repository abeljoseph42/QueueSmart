const request = require('supertest');
const { createApp } = require('../src/app');
const { EVENTS } = require('../src/shared/events');

const entry = { id: 'e1', userId: 'u1', serviceId: 's1', priority: 'medium',
  joinedAt: '2026-10-22T12:00:00.000Z', status: 'waiting' };
const user = { id: 'u1', name: 'Test User', email: 'user@example.com', role: 'user' };

test('each app starts its own subscribers', async () => {
  const app = createApp({ resolveUser: async () => user });
  const other = createApp();
  app.locals.events.publish(EVENTS.JOINED, { entry });
  app.locals.events.publish(EVENTS.SERVED, { entry: { ...entry, status: 'served' } });
  expect((await request(app).get('/api/me/notifications')).body.data).toHaveLength(2);
  expect((await request(app).get('/api/me/history')).body.data).toHaveLength(1);
  expect(other.locals.store.notifications.size).toBe(0);
  app.locals.stopSubscribers();
  other.locals.stopSubscribers();
});

test('stopping subscribers stops new records', () => {
  const app = createApp();
  app.locals.stopSubscribers();
  app.locals.events.publish(EVENTS.JOINED, { entry });
  expect(app.locals.store.notifications.size).toBe(0);
});
