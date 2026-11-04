const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { ApiError } = require('../../shared/errors');
const { createServiceRepository } = require('./serviceRepository');

const QUEUE_STATUSES = Object.freeze(['open', 'closed']);
const status = z.enum(QUEUE_STATUSES);

const toQueue = row => row && { id: row.id, serviceId: row.service_id, status: row.status };

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Queue not found.');

function parseStatus(value) {
  const result = status.safeParse(value);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
    [{ path: 'status', message: 'Status must be open or closed.' }]);
  return result.data;
}

function createQueueRepository(db) {
  function findByServiceId(serviceId, conn = db) {
    return toQueue(conn.prepare('SELECT * FROM queue WHERE service_id = ?').get(serviceId)) ?? null;
  }

  // New queues start closed; an admin opens them.
  function createForService(serviceId, conn = db) {
    conn.prepare('INSERT INTO queue (id, service_id, status, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), serviceId, 'closed', new Date().toISOString());
    return findByServiceId(serviceId, conn);
  }

  function getQueue(queueId, conn = db) {
    const queue = toQueue(conn.prepare('SELECT * FROM queue WHERE id = ?').get(queueId));
    if (!queue) throw notFound();
    return queue;
  }

  function setStatus(queueId, value, conn = db) {
    const next = parseStatus(value);
    if (conn.prepare('UPDATE queue SET status = ? WHERE id = ?').run(next, queueId).changes === 0) throw notFound();
    return getQueue(queueId, conn);
  }

  function setStatusByServiceId(serviceId, value, conn = db) {
    const queue = findByServiceId(serviceId, conn);
    if (!queue) throw notFound();
    return setStatus(queue.id, value, conn);
  }

  return { createForService, findByServiceId, getQueue, setStatus, setStatusByServiceId };
}

// Shared contract for Bryan's join: run inside the join's write transaction.
function assertJoinable(tx, queueId) {
  const queue = createQueueRepository(tx).getQueue(queueId);
  const service = createServiceRepository(tx).getService(queue.serviceId);
  if (!service.isActive) throw new ApiError(409, 'SERVICE_INACTIVE', 'This service is not accepting new joins.');
  if (queue.status !== 'open') throw new ApiError(409, 'QUEUE_CLOSED', 'This queue is closed to new joins.');
  return { queue, service };
}

module.exports = { QUEUE_STATUSES, createQueueRepository, assertJoinable };
