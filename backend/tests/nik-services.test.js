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