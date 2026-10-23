const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');

const user = id => ({ id, name: id, email: `${id}@example.com`, role: 'user' });
const svc = (id, minutes) => ({ id, name: `Service ${id}`, description: 'Help desk',
  expectedDurationMinutes: minutes, priority: 'medium', isOpen: true });

function setup() {
  const store = createStore();
  store.services.set('s1', svc('s1', 10));
  store.services.set('s2', svc('s2', 5));
  const events = createEventBus();
  const log = [];
  for (const name of Object.values(EVENTS)) events.subscribe(name, ({ entry }) => log.push([name, entry.userId]));
  let current = user('u1');
  const app = createApp({ store, events, resolveUser: async () => current });
  const as = id => { current = user(id); return request(app); };
  const join = (id, s) => as(id).post(`/api/services/${s}/queue/join`).send({});
  const status = (id, s) => as(id).get(`/api/services/${s}/queue/me`);
  return { store, log, as, join, status };
}

test('multiple users across multiple services keep separate positions and waits', async () => {
  const { join, status } = setup();
  await join('u1', 's1');
  await join('u2', 's1');
  await join('u2', 's2');
  await join('u3', 's2');
  expect((await status('u2', 's1')).body.data).toMatchObject({ position: 2, estimatedWaitMinutes: 10 });
  expect((await status('u2', 's2')).body.data).toMatchObject({ position: 1, estimatedWaitMinutes: 0 });
  expect((await status('u3', 's2')).body.data).toMatchObject({ position: 2, estimatedWaitMinutes: 5 });
  expect((await status('u3', 's1')).status).toBe(404);
});

test('positions and waits update after an entry is served by an admin action', async () => {
  const { store, log, join, status } = setup();
  for (const id of ['u1', 'u2', 'u3', 'u4']) await join(id, 's1');
  
  const first = [...store.queueEntries.values()].find(e => e.userId === 'u1');
  store.queueEntries.set(first.id, { ...first, status: 'served' });
  expect((await status('u4', 's1')).body.data).toMatchObject({ position: 3, estimatedWaitMinutes: 20 });
  expect((await status('u2', 's1')).body.data.position).toBe(1);
  expect(log.filter(([name]) => name === EVENTS.NEAR).map(([, u]) => u)).toEqual(['u1', 'u2']);
});

test('leave and rejoin produces a fresh entry with its own near event', async () => {
  const { log, as, join } = setup();
  await join('u1', 's1');
  await as('u1').delete('/api/services/s1/queue/me');
  await join('u1', 's1');
  expect(log).toEqual([
    [EVENTS.JOINED, 'u1'], [EVENTS.NEAR, 'u1'],
    [EVENTS.LEFT, 'u1'],
    [EVENTS.JOINED, 'u1'], [EVENTS.NEAR, 'u1'],
  ]);
});