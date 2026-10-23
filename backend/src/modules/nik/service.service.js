const { ApiError } = require('../../shared/errors');
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

    function updateService(serviceId, changes) {
    const existing = store.services.get(serviceId);

    if (!existing) {
      throw new ApiError(
        404,
        'SERVICE_NOT_FOUND',
        'Service not found.'
      );
    }

    const editableFields = [
      'name',
      'description',
      'expectedDurationMinutes',
      'priority',
    ];

    const updated = { ...existing };

    for (const field of editableFields) {
      if (Object.hasOwn(changes, field)) {
        updated[field] = changes[field];
      }
    }

    store.services.set(serviceId, updated);

    return { ...updated };
  }

  return { createService, listServices, updateService };
}

module.exports = { createServiceManager };