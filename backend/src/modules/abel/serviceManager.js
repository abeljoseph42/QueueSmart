const { ApiError } = require('../../shared/errors');
const { withWriteTransaction } = require('../../database/connection');
const { createServiceRepository } = require('./serviceRepository');
const { createQueueRepository } = require('./queueRepository');

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
  const queues = createQueueRepository(db);

  // Temporary adapter: queue, admin, and dashboard modules still read store.services.
  // isOpen comes from the queue table. Remove once those modules read the database.
  const sync = service => {
    const synced = toApi(service, queues.findByServiceId(service.id)?.status === 'open');
    store.services.set(service.id, synced);
    return { ...synced };
  };
  services.list().forEach(sync);

  function createService(input) {
    return sync(withWriteTransaction(db, tx => {
      const service = services.create(toRepositoryInput(input), tx);
      queues.createForService(service.id, tx);
      return service;
    }));
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

  function setQueueOpen(serviceId, isOpen) {
    const service = withWriteTransaction(db, tx => {
      const found = services.findById(serviceId, tx);
      if (!found) throw new ApiError(404, 'NOT_FOUND', 'Service not found.');
      queues.setStatusByServiceId(serviceId, isOpen ? 'open' : 'closed', tx);
      return found;
    });
    return sync(service);
  }

  function getStats() {
    return { ...db.prepare(`SELECT
      (SELECT count(*) FROM service) AS serviceCount,
      (SELECT count(*) FROM service WHERE is_active = 1) AS activeServiceCount,
      (SELECT count(*) FROM queue WHERE status = 'open') AS openQueueCount,
      (SELECT count(*) FROM queue WHERE status = 'closed') AS closedQueueCount`).get() };
  }

  return { createService, listServices, updateService, getService, setQueueOpen, getStats };
}

module.exports = { PRIORITY_TO_LEVEL, LEVEL_TO_PRIORITY, createServiceManager };
