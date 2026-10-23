const { randomUUID } = require('node:crypto');

function createServiceManager({ store }) {
  function createService({
    name,
    description,
    expectedDurationMinutes,
    priority,
  }) {
    const service = {
      id: randomUUID(),
      name,
      description,
      expectedDurationMinutes,
      priority,
      isOpen: true,
    };

    store.services.set(service.id, service);

    return { ...service };
  }

  function listServices() {
    return [...store.services.values()].map(service => ({
      ...service,
    }));
  }

  return { createService, listServices };
}

module.exports = { createServiceManager };