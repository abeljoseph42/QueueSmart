const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');
const { initQueueSubscribers } = require('../src/modules/abel/subscribers');

const entry = { id: 'e1', userId: 'u1', serviceId: 's1', priority: 'medium',
  joinedAt: '2026-10-22T12:00:00.000Z', status: 'waiting' };

function setup(handlers) {
  const store = createStore();
  const events = createEventBus();
  const cleanup = initQueueSubscribers({ store, events }, [handlers]);
  return { store, events, cleanup };
}

test('passes each queue event payload and the store to its handler', () => {
  const handlers = Object.fromEntries(Object.values(EVENTS).map(name => [name, jest.fn()]));
  const { store, events, cleanup } = setup(handlers);
  for (const name of Object.values(EVENTS)) {
    events.publish(name, { entry });
    expect(handlers[name]).toHaveBeenCalledWith({ entry }, store);
  }
  cleanup();
});

test('events without a handler are ignored', () => {
  const joined = jest.fn();
  const { events, cleanup } = setup({ [EVENTS.JOINED]: joined });
  expect(() => events.publish(EVENTS.SERVED, { entry: { ...entry, status: 'served' } })).not.toThrow();
  expect(joined).not.toHaveBeenCalled();
  cleanup();
});

test('initializing twice on one bus does not add duplicate listeners', () => {
  const joined = jest.fn();
  const { store, events, cleanup } = setup({ [EVENTS.JOINED]: joined });
  expect(initQueueSubscribers({ store, events }, [{ [EVENTS.JOINED]: joined }])).toBe(cleanup);
  events.publish(EVENTS.JOINED, { entry });
  expect(joined).toHaveBeenCalledTimes(1);
  cleanup();
});

test('cleanup removes listeners and allows a fresh setup', () => {
  const joined = jest.fn();
  const { store, events, cleanup } = setup({ [EVENTS.JOINED]: joined });
  cleanup();
  events.publish(EVENTS.JOINED, { entry });
  expect(joined).not.toHaveBeenCalled();
  const again = initQueueSubscribers({ store, events }, [{ [EVENTS.JOINED]: joined }]);
  events.publish(EVENTS.JOINED, { entry });
  expect(joined).toHaveBeenCalledTimes(1);
  again();
});

test('separate apps keep separate subscribers', () => {
  const a = jest.fn();
  const b = jest.fn();
  const first = setup({ [EVENTS.JOINED]: a });
  const second = setup({ [EVENTS.JOINED]: b });
  first.events.publish(EVENTS.JOINED, { entry });
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
  first.cleanup();
  second.cleanup();
});

test('works with no handler sets', () => {
  const store = createStore();
  const events = createEventBus();
  const cleanup = initQueueSubscribers({ store, events });
  expect(() => events.publish(EVENTS.JOINED, { entry })).not.toThrow();
  cleanup();
});
