const { ApiError } = require('../../shared/errors');
const { withWriteTransaction } = require('../../database/connection');
const { createServiceRepository } = require('./serviceRepository');

// The A3 API keeps low/medium/high; the database stores priority_level 0/1/2.
const PRIORITY_TO_LEVEL = Object.freeze({ low: 0, medium: 1, high: 2 });
const LEVEL_TO_PRIORITY = Object.freeze({ 0: 'low', 1: 'medium', 2: 'high' });

function toRepositoryInput({ priority, ...fields }) {
  return priority === undefined ? fields : { ...fields, priorityLevel: PRIORITY_TO_LEVEL[priority] };
}

const toApi = ({ priorityLevel, ...service }, isOpen) =>
  ({ ...service, priority: LEVEL_TO_PRIORITY[priorityLevel], isOpen });

const notFound = () => new ApiError(404, 'SERVICE_NOT_FOUND', 'Service not found.');

function createServiceManager({ store, db }) {
  const services = createServiceRepository(db);

  // Temporary adapter: queue, admin, and dashboard modules still read store.services,
  // and isOpen lives only in memory until the Stage 3 queue table. Remove once they read the database.
  const sync = service => {
    const synced = toApi(service, store.services.get(service.id)?.isOpen ?? true);
    store.services.set(service.id, synced);
    return { ...synced };
  };
  services.list().forEach(sync);

  function createService(input) {
    return sync(withWriteTransaction(db, tx => services.create(toRepositoryInput(input), tx)));
  }

  function listServices() {
    return services.list().map(sync);
  }

  function updateService(serviceId, changes) {
    const updated = withWriteTransaction(db, tx => {
      if (!services.findById(serviceId, tx)) throw notFound();
      return services.update(serviceId, toRepositoryInput(changes), tx);
    });
    return sync(updated);
  }

  function getService(serviceId) {
    const service = services.findById(serviceId);
    if (!service) throw notFound();
    return sync(service);
  }

  return { createService, listServices, updateService, getService };
}

module.exports = { PRIORITY_TO_LEVEL, LEVEL_TO_PRIORITY, createServiceManager };
