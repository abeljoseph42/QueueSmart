const { ApiError } = require('../../shared/errors');
const { EVENTS } = require('../../shared/events');
const { withWriteTransaction } = require('../../database/connection');
const { createServiceRepository } = require('../abel/serviceRepository');
const { createQueueRepository, assertJoinable } = require('../abel/queueRepository');
const { LEVEL_TO_PRIORITY } = require('../abel/serviceManager');
const { checkNearEvents } = require('./queueService');
const { createQueueEntryRepository } = require('./queueEntryRepository');

const serviceNotFound = () => new ApiError(404, 'NOT_FOUND', 'Service not found.');
const entryNotFound = () => new ApiError(404, 'NOT_FOUND', 'Queue entry not found.');
const notInQueue = () => new ApiError(404, 'NOT_IN_QUEUE', 'You are not waiting in this queue.');

function createQueueEntryService({ db, store, events, now }) {
  const entries = createQueueEntryRepository(db, { now });
  const services = createServiceRepository(db);
  const queues = createQueueRepository(db);

  function toA3Entry(entry, serviceId, canceledAs = 'left') {
    return {
      id: entry.id,
      serviceId,
      userId: entry.userId,
      priority: LEVEL_TO_PRIORITY[entry.priorityLevel],
      joinedAt: entry.joinedAt,
      status: entry.status === 'canceled' ? canceledAs : entry.status,
    };
  }

  function toA3Status(entry, service) {
    return {
      entry: toA3Entry(entry, service.id),
      position: entry.position,
      estimatedWaitMinutes: (entry.position - 1) * service.expectedDurationMinutes,
    };
  }

  function mirror(a3Entry) {
    store.queueEntries.set(a3Entry.id, a3Entry);
  }

  function hydrate() {
    const rows = db.prepare(`
      SELECT e.*, q.service_id FROM queue_entry e JOIN queue q ON q.id = e.queue_id
      WHERE e.status = 'waiting' ORDER BY e.queue_id, e.position
    `).all();
    rows.forEach(row => mirror(toA3Entry(entries.findById(row.id), row.service_id)));
    return rows.length;
  }

  function queueForService(serviceId, conn = db) {
    if (!services.findById(serviceId, conn)) throw serviceNotFound();
    return queues.findByServiceId(serviceId, conn);
  }

  function joinInTransaction(tx, actor, queueId) {
    if (!tx.prepare('SELECT 1 FROM user_credentials WHERE id = ?').get(actor.id)) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }
    const { service } = assertJoinable(tx, queueId); 
    if (entries.findWaiting(queueId, actor.id, tx)) {
      throw new ApiError(409, 'ALREADY_IN_QUEUE', 'You are already waiting in this queue.');
    }
    return entries.insertWaiting({ queueId, userId: actor.id, priorityLevel: service.priorityLevel }, tx);
  }

  function joinQueue(actor, queueId) {
    const entry = withWriteTransaction(db, tx => joinInTransaction(tx, actor, queueId));
    const serviceId = queues.getQueue(queueId).serviceId;
    const a3 = toA3Entry(entry, serviceId);
    mirror(a3);
    events.publish(EVENTS.JOINED, { entry: a3 }); 
    checkNearEvents(store, events, serviceId);
    return entry;
  }

  function cancelInTransaction(tx, actor, entryId) {
    const entry = entries.findById(entryId, tx);
    if (!entry || (actor.role !== 'admin' && entry.userId !== actor.id)) throw entryNotFound();
    if (entry.status === 'canceled') return { entry, changed: false };
    if (entry.status === 'served') {
      throw new ApiError(409, 'ENTRY_FINALIZED', 'This queue entry has already been served.');
    }
    return { entry: entries.finishEntry(entryId, 'canceled', tx), changed: true };
  }

  function cancelEntry(actor, entryId) {
    const { entry, changed } = withWriteTransaction(db, tx => cancelInTransaction(tx, actor, entryId));
    const serviceId = queues.getQueue(entry.queueId).serviceId;
    const canceledAs = entry.userId === actor.id ? 'left' : 'removed';
    if (changed) {
      const a3 = toA3Entry(entry, serviceId, canceledAs);
      mirror(a3);
      events.publish(canceledAs === 'left' ? EVENTS.LEFT : EVENTS.REMOVED, { entry: a3 });
      checkNearEvents(store, events, serviceId);
    }
    return { entry, changed, serviceId, canceledAs };
  }


  function joinByService(actor, serviceId) {
    const queue = queueForService(serviceId);
    const entry = joinQueue(actor, queue.id);
    return toA3Status(entry, services.findById(serviceId));
  }

  function leaveByService(actor, serviceId) {
    const queue = queueForService(serviceId);
    const waiting = entries.findWaiting(queue.id, actor.id);
    if (!waiting) throw notInQueue();
    const { entry, canceledAs } = cancelEntry(actor, waiting.id);
    return { entry: toA3Entry(entry, serviceId, canceledAs) };
  }

  function statusByService(actor, serviceId) {
    const queue = queueForService(serviceId);
    const entry = entries.findWaiting(queue.id, actor.id);
    if (!entry) throw notInQueue();
    return toA3Status(entry, services.findById(serviceId));
  }

  return {
    joinQueue, joinInTransaction, cancelEntry, cancelInTransaction,
    joinByService, leaveByService, statusByService, hydrate, toA3Entry,
  };
}

module.exports = { createQueueEntryService };