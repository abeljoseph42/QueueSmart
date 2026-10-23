const { createStore } = require('../src/shared/store');
const {
  createServiceManager,
} = require('../src/modules/nik/service.service');

let store;
let serviceManager;

const advising = {
  name: 'Academic Advising',
  description: 'Help with course planning',
  expectedDurationMinutes: 10,
  priority: 'medium',
};

beforeEach(() => {
  store = createStore();
  serviceManager = createServiceManager({ store });
});

test('returns an empty list when no services exist', () => {
  expect(serviceManager.listServices()).toEqual([]);
});

test('creates an open service in the shared store', () => {
  const service = serviceManager.createService(advising);

  expect(service).toEqual({
    id: expect.any(String),
    ...advising,
    isOpen: true,
  });

  expect(store.services.get(service.id)).toEqual(service);
});

test('lists services created through the manager', () => {
  const first = serviceManager.createService(advising);

  const second = serviceManager.createService({
    name: 'IT Support',
    description: 'Help with technical issues',
    expectedDurationMinutes: 15,
    priority: 'high',
  });

  expect(serviceManager.listServices()).toEqual([
    first,
    second,
  ]);
});

test('updates selected fields while preserving ID and queue state', () => {
  const created = serviceManager.createService(advising);

  // Simulate Heera closing this service's queue.
  store.services.get(created.id).isOpen = false;

  const updated = serviceManager.updateService(created.id, {
    name: 'Updated Advising',
    expectedDurationMinutes: 20,
  });

  expect(updated).toEqual({
    ...created,
    name: 'Updated Advising',
    expectedDurationMinutes: 20,
    isOpen: false,
  });

  expect(store.services.get(created.id)).toEqual(updated);
  expect(store.services.size).toBe(1);
});

test('rejects updates to an unknown service', () => {
  expect.assertions(3);

  try {
    serviceManager.updateService('missing-service', {
      name: 'Updated Advising',
    });
  } catch (error) {
    expect(error.status).toBe(404);
    expect(error.code).toBe('SERVICE_NOT_FOUND');
  }

  expect(store.services.size).toBe(0);
});