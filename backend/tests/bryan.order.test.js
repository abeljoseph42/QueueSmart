const request = require('supertest');
const { createApp } = require('../src/app');
const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');
const queue = require('../src/modules/bryan/queueService');

const user = id => ({ id, name: `User ${id}`, email: `${id}@example.com`, role: 'user' });
const service = { id: 's1', name: 'Academic Advising', description: 'Course planning help',
  expectedDurationMinutes: 10, priority: 'medium', isOpen: true };
const other = { ...service, id: 's2', name: 'Technical Support' };

function setup() {
  const store = createStore();
  store.services.set('s1', { ...service });
  store.services.set('s2', { ...other });
  const events = createEventBus();
  const near = jest.fn();
  events.subscribe(EVENTS.NEAR, near);
  return { store, events, near, ctx: { store, events } };
}

let seq = 0;
function seed(store, { id, priority = 'medium', joinedAt, serviceId = 's1', status = 'waiting' }) {
  seq += 1;
  const entry = { id, serviceId, userId: `user-${id}`, priority, status,
    joinedAt: joinedAt || new Date(Date.UTC(2026, 9, 22, 12, 0, seq)).toISOString() };
  store.queueEntries.set(id, entry);
  return entry;
}
const ids = (store, serviceId = 's1') => queue.waitingEntries(store, serviceId).map(e => e.id);

describe('automatic order', () => {
  test('high, then medium, then low; arrival order within a priority', () => {
    const { store } = setup();
    seed(store, { id: 'low1', priority: 'low' });
    seed(store, { id: 'med1', priority: 'medium' });
    seed(store, { id: 'high1', priority: 'high' });
    seed(store, { id: 'med2', priority: 'medium' });
    expect(ids(store)).toEqual(['high1', 'med1', 'med2', 'low1']);
  });

  test('identical join times use the entry ID as a stable tie-break', () => {
    const { store } = setup();
    const t = '2026-10-22T12:00:00.000Z';
    seed(store, { id: 'b', joinedAt: t });
    seed(store, { id: 'a', joinedAt: t });
    expect(ids(store)).toEqual(['a', 'b']);
    expect(ids(store)).toEqual(['a', 'b']); 
  });

  test('only waiting entries of the requested service are included', () => {
    const { store } = setup();
    seed(store, { id: 'x' });
    seed(store, { id: 'gone', status: 'served' });
    seed(store, { id: 'elsewhere', serviceId: 's2' });
    expect(ids(store)).toEqual(['x']);
    expect(ids(store, 's2')).toEqual(['elsewhere']);
  });
});

describe('wait estimates', () => {
  test('wait is (position - 1) x expected duration and public entries have no extra fields', () => {
    const { store } = setup();
    seed(store, { id: 'a' });
    seed(store, { id: 'b' });
    seed(store, { id: 'c' });
    const list = queue.orderedQueue(store, 's1');
    expect(list.map(s => [s.position, s.estimatedWaitMinutes])).toEqual([[1, 0], [2, 10], [3, 20]]);
    expect(Object.keys(list[0].entry).sort())
      .toEqual(['id', 'joinedAt', 'priority', 'serviceId', 'status', 'userId']);
  });

  test('unknown service is a 404', () => {
    const { store } = setup();
    expect(() => queue.orderedQueue(store, 'nope')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('manual reorder (moveEntry)', () => {
  test('moves an entry and the manual order survives later reads', () => {
    const { store } = setup();
    ['a', 'b', 'c'].forEach(id => seed(store, { id }));
    const result = queue.moveEntry(store, 's1', 'c', 1);
    expect(result.map(s => s.entry.id)).toEqual(['c', 'a', 'b']);
    expect(result[0].estimatedWaitMinutes).toBe(0);
    expect(ids(store)).toEqual(['c', 'a', 'b']);
  });

  test('a new join after a reorder goes to the back of its priority group', () => {
    const { store } = setup();
    seed(store, { id: 'h1', priority: 'high' });
    seed(store, { id: 'm1', priority: 'medium' });
    seed(store, { id: 'l1', priority: 'low' });
    queue.moveEntry(store, 's1', 'l1', 1); 
    seed(store, { id: 'm2', priority: 'medium' });
    expect(ids(store)).toEqual(['l1', 'h1', 'm1', 'm2']);
  });

  test('with no same-priority entry, a newcomer goes before the first lower priority, or at the end', () => {
    const { store } = setup();
    seed(store, { id: 'm1', priority: 'medium' });
    seed(store, { id: 'l1', priority: 'low' });
    queue.moveEntry(store, 's1', 'l1', 1);
    seed(store, { id: 'h1', priority: 'high' });
    expect(ids(store)).toEqual(['h1', 'l1', 'm1']); 
    const { store: s2 } = setup();
    seed(s2, { id: 'h1', priority: 'high' });
    seed(s2, { id: 'm1', priority: 'medium' });
    queue.moveEntry(s2, 's1', 'm1', 1);
    seed(s2, { id: 'l1', priority: 'low' });
    expect(ids(s2)).toEqual(['m1', 'h1', 'l1']); 
  });

  test('positions outside 1..length throw 400', () => {
    const { store } = setup();
    ['a', 'b'].forEach(id => seed(store, { id }));
    for (const position of [0, 3, 1.5]) {
      expect(() => queue.moveEntry(store, 's1', 'a', position))
        .toThrow(expect.objectContaining({ status: 400, code: 'INVALID_POSITION' }));
    }
  });

  test('missing, other-service, or non-waiting entries throw 404', () => {
    const { store } = setup();
    seed(store, { id: 'a' });
    seed(store, { id: 'done', status: 'served' });
    seed(store, { id: 'other', serviceId: 's2' });
    for (const entryId of ['nope', 'done', 'other']) {
      expect(() => queue.moveEntry(store, 's1', entryId, 1)).toThrow(expect.objectContaining({ status: 404 }));
    }
    expect(() => queue.moveEntry(store, 'nope', 'a', 1)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('near events', () => {
  test('fire once per entry the first time it reaches position 1 or 2', () => {
    const { store, events, near } = setup();
    ['a', 'b', 'c'].forEach(id => seed(store, { id }));
    queue.checkNearEvents(store, events, 's1');
    expect(near.mock.calls.map(([p]) => p.entry.id)).toEqual(['a', 'b']);
    queue.checkNearEvents(store, events, 's1');
    expect(near).toHaveBeenCalledTimes(2); 
    store.queueEntries.set('a', { ...store.queueEntries.get('a'), status: 'served' });
    queue.checkNearEvents(store, events, 's1');
    expect(near.mock.calls.map(([p]) => p.entry.id)).toEqual(['a', 'b', 'c']);
    queue.moveEntry(store, 's1', 'b', 2);
    queue.moveEntry(store, 's1', 'b', 1);
    queue.checkNearEvents(store, events, 's1');
    expect(near).toHaveBeenCalledTimes(3); 
  });

  test('joining and leaving through the API trigger near events', async () => {
    const { store, events, near } = setup();
    let current = user('u1');
    const app = createApp({ store, events, resolveUser: async () => current });
    const as = id => { current = user(id); return request(app); };
    const joined = [];
    events.subscribe(EVENTS.JOINED, ({ entry }) => joined.push(entry.userId));
    await as('u1').post('/api/services/s1/queue/join').send({});
    await as('u2').post('/api/services/s1/queue/join').send({});
    await as('u3').post('/api/services/s1/queue/join').send({});
    expect(joined).toEqual(['u1', 'u2', 'u3']);
    expect(near.mock.calls.map(([p]) => p.entry.userId)).toEqual(['u1', 'u2']); 
    await as('u1').delete('/api/services/s1/queue/me');
    expect(near.mock.calls.map(([p]) => p.entry.userId)).toEqual(['u1', 'u2', 'u3']); 
    const status = await as('u3').get('/api/services/s1/queue/me');
    expect(status.body.data).toMatchObject({ position: 2, estimatedWaitMinutes: 10 });
  });

  test('user status reflects an admin reorder', async () => {
    const { store, events } = setup();
    let current = user('u1');
    const app = createApp({ store, events, resolveUser: async () => current });
    const as = id => { current = user(id); return request(app); };
    await as('u1').post('/api/services/s1/queue/join').send({});
    const last = (await as('u2').post('/api/services/s1/queue/join').send({})).body.data.entry;
    queue.moveEntry(store, 's1', last.id, 1);
    expect((await as('u2').get('/api/services/s1/queue/me')).body.data.position).toBe(1);
    expect((await as('u1').get('/api/services/s1/queue/me')).body.data.position).toBe(2);
  });
});