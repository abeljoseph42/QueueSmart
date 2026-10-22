const c = require('../src/shared/contracts');
const { createStore } = require('../src/shared/store');
const { createEventBus, EVENTS } = require('../src/shared/events');
const { requireRole } = require('../src/middleware/auth');
const { createApp } = require('../src/app');
const entry = { id: 'e1', userId: 'u1', serviceId: 's1', priority: 'medium',
  joinedAt: '2026-10-22T12:00:00.000Z', status: 'waiting' };

test('stores and application instances never share state', () => {
  const a = createStore();
  const b = createStore();
  for (const name of Object.keys(a)) {
    a[name].set('one', { id: 'one' });
    expect(b[name].size).toBe(0);
  }
  expect(createApp().locals.store).not.toBe(createApp().locals.store);
});

test('event payload validation, unsubscribe, and isolated buses', () => {
  const a = createEventBus();
  const b = createEventBus();
  const listener = jest.fn();
  const unsubscribe = a.subscribe(EVENTS.JOINED, listener);
  b.publish(EVENTS.JOINED, { entry });
  expect(listener).not.toHaveBeenCalled();
  a.publish(EVENTS.JOINED, { entry });
  expect(listener).toHaveBeenCalledWith({ entry });
  unsubscribe();
  a.publish(EVENTS.JOINED, { entry });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(() => a.publish(EVENTS.JOINED, {})).toThrow();
  expect(() => a.publish('typo', { entry })).toThrow('Unknown event');
  expect(() => a.subscribe('typo', listener)).toThrow('Unknown event');
});

test('role guard is safe even without preceding auth middleware', () => {
  const next = jest.fn();
  requireRole('admin')({}, {}, next);
  expect(next.mock.calls[0][0].status).toBe(401);
});

test('service field boundaries, strictness, and update contracts', () => {
  const good = { name: ' Service ', description: 'Description', expectedDurationMinutes: 1, priority: 'low' };
  expect(c.createService.parse(good).name).toBe('Service');
  for (const invalid of [
    { name: '' }, { name: 'x'.repeat(101) }, { description: '' }, { description: 'x'.repeat(1001) },
    { expectedDurationMinutes: 0 }, { expectedDurationMinutes: 481 }, { expectedDurationMinutes: 1.5 },
    { priority: 'urgent' }, { extra: true },
  ]) expect(c.createService.safeParse({ ...good, ...invalid }).success).toBe(false);
  expect(c.updateService.safeParse({}).success).toBe(false);
  expect(c.updateService.parse({ priority: 'high' })).toEqual({ priority: 'high' });
});

test('auth contracts normalize emails and reject invalid credentials', () => {
  const good = { name: 'User', email: 'USER@example.com', password: '12345678' };
  expect(c.register.parse(good).email).toBe('user@example.com');
  for (const value of [{ ...good, email: 'invalid' }, { ...good, password: 'short' },
    { ...good, password: 'x'.repeat(129) }, { ...good, role: 'admin' }, {}]) {
    expect(c.register.safeParse(value).success).toBe(false);
  }
});

test('shared output models and parameter contracts', () => {
  expect(c.queueEntry.parse(entry)).toEqual(entry);
  expect(c.queueStatus.parse({ entry, position: 1, estimatedWaitMinutes: 0 }).position).toBe(1);
  expect(c.queueStatus.safeParse({ entry, position: 0, estimatedWaitMinutes: -1 }).success).toBe(false);
  expect(c.entryParams.safeParse({ serviceId: '', entryId: 'e1' }).success).toBe(false);
  expect(c.queueState.safeParse({ isOpen: 'true' }).success).toBe(false);
  expect(c.reorder.safeParse({ position: 0 }).success).toBe(false);
  expect(c.historyRecord.parse({ id: 'h1', entryId: entry.id, userId: entry.userId, serviceId: entry.serviceId,
    joinedAt: entry.joinedAt, endedAt: entry.joinedAt, outcome: 'served' }).outcome).toBe('served');
  expect(c.notification.parse({ id: 'n1', userId: 'u1', entryId: 'e1', type: EVENTS.JOINED,
    message: 'You joined the queue.', createdAt: entry.joinedAt }).type).toBe(EVENTS.JOINED);
});
