const { ApiError } = require('../../shared/errors');
const { EVENTS } = require('../../shared/events');
const { withWriteTransaction } = require('../../database/connection');
const { createServiceRepository } = require('../abel/serviceRepository');
const { createQueueRepository, assertJoinable } = require('../abel/queueRepository');
const { LEVEL_TO_PRIORITY, PRIORITY_TO_LEVEL } = require('../abel/serviceManager');
const { checkNearEvents, setQueueOrder } = require('./queueService');
const { createQueueEntryRepository } = require('./queueEntryRepository');

const PRIORITY_LEVELS = Object.freeze([0, 1, 2]);

const serviceNotFound = () => new ApiError(404, 'NOT_FOUND', 'Service not found.');
const entryNotFound = () => new ApiError(404, 'NOT_FOUND', 'Queue entry not found.');
const notInQueue = () => new ApiError(404, 'NOT_IN_QUEUE', 'You are not waiting in this queue.');

function requireAdmin(actor) {
  if (actor?.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions.');
}

function createQueueEntryService({ db, store, events, notifications, now }) {
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

  function syncQueue(queueId, serviceId) {
    const waiting = entries.listWaiting(queueId);
    waiting.forEach(entry => mirror(toA3Entry(entry, serviceId)));
    setQueueOrder(store, serviceId, waiting.map(entry => entry.id));
  }

  function hydrate() {
    const queuesWithEntries = db.prepare(`
      SELECT DISTINCT q.id, q.service_id FROM queue q
      JOIN queue_entry e ON e.queue_id = q.id AND e.status = 'waiting'
    `).all();
    queuesWithEntries.forEach(row => syncQueue(row.id, row.service_id));
    return db.prepare("SELECT count(*) AS n FROM queue_entry WHERE status = 'waiting'").get().n;
  }

  function enqueue(tx, entry, type, subject, message) {
    if (!notifications) return null;
    const eventKey = `${type}:${entry.id}`;
    return notifications.enqueueNotification(tx, { userId: entry.userId, eventKey, type, subject, message })
      .notification.id;
  }

  function deliver(notificationId) {
    if (notificationId) notifications.deliverAfterCommit(notificationId);
  }

  const settled = () => (notifications ? notifications.settled() : Promise.resolve());

  function queueForService(serviceId, conn = db) {
    const service = services.findById(serviceId, conn);
    if (!service) throw serviceNotFound();
    return { service, queue: queues.findByServiceId(serviceId, conn) };
  }

  function joinInTransaction(tx, actor, queueId) {
    if (!tx.prepare('SELECT 1 FROM user_credentials WHERE id = ?').get(actor.id)) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }
    const { service } = assertJoinable(tx, queueId);
    if (entries.findWaiting(queueId, actor.id, tx)) {
      throw new ApiError(409, 'ALREADY_IN_QUEUE', 'You are already waiting in this queue.');
    }
    const entry = entries.insertWaiting({ queueId, userId: actor.id, priorityLevel: service.priorityLevel }, tx);
    const notificationId = enqueue(tx, entry, 'queue.joined', `Joined ${service.name}`,
      `You joined the ${service.name} queue.`);
    return { entry, serviceId: service.id, notificationId };
  }

  function joinQueue(actor, queueId) {
    const { entry, serviceId, notificationId } = withWriteTransaction(db, tx => joinInTransaction(tx, actor, queueId));
    syncQueue(queueId, serviceId);
    events.publish(EVENTS.JOINED, { entry: toA3Entry(entry, serviceId) });
    checkNearEvents(store, events, serviceId);
    deliver(notificationId);
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
      syncQueue(entry.queueId, serviceId);
      events.publish(canceledAs === 'left' ? EVENTS.LEFT : EVENTS.REMOVED, { entry: a3 });
      checkNearEvents(store, events, serviceId);
    }
    return { entry, changed, serviceId, canceledAs };
  }

  function serveInTransaction(tx, admin, queueId) {
    requireAdmin(admin);
    const queue = queues.getQueue(queueId, tx);
    const [first] = entries.listWaiting(queueId, tx);
    if (!first) throw new ApiError(409, 'QUEUE_EMPTY', 'Queue is empty.');
    const entry = entries.finishEntry(first.id, 'served', tx);
    const service = services.findById(queue.serviceId, tx);
    const notificationId = enqueue(tx, entry, 'queue.served', `Served at ${service.name}`,
      `You have been served at ${service.name}.`);
    return { entry, serviceId: queue.serviceId, notificationId };
  }

  function serveNext(admin, queueId) {
    const { entry, serviceId, notificationId } = withWriteTransaction(db, tx => serveInTransaction(tx, admin, queueId));
    const a3 = toA3Entry(entry, serviceId);
    mirror(a3);
    syncQueue(queueId, serviceId);
    events.publish(EVENTS.SERVED, { entry: a3 });
    checkNearEvents(store, events, serviceId);
    deliver(notificationId);
    return entry;
  }

  function setPriorityInTransaction(tx, admin, entryId, priorityLevel) {
    requireAdmin(admin);
    if (!PRIORITY_LEVELS.includes(priorityLevel)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
        [{ path: 'priorityLevel', message: 'Priority level must be 0, 1, or 2.' }]);
    }
    const entry = entries.findById(entryId, tx);
    if (!entry) throw entryNotFound();
    if (entry.status !== 'waiting') {
      throw new ApiError(409, 'ENTRY_FINALIZED', 'This queue entry is no longer waiting.');
    }
    if (entry.priorityLevel === priorityLevel) return { entry, changed: false };
    return { entry: entries.updatePriority(entryId, priorityLevel, tx), changed: true };
  }

  function setEntryPriority(admin, entryId, priorityLevel) {
    const { entry, changed } = withWriteTransaction(db,
      tx => setPriorityInTransaction(tx, admin, entryId, priorityLevel));
    if (changed) {
      const serviceId = queues.getQueue(entry.queueId).serviceId;
      syncQueue(entry.queueId, serviceId);
      checkNearEvents(store, events, serviceId);
    }
    return entry;
  }

  const getEntryStats = () => entries.countByStatus();

  function joinByService(actor, serviceId) {
    const { service, queue } = queueForService(serviceId);
    return toA3Status(joinQueue(actor, queue.id), service);
  }

  function leaveByService(actor, serviceId) {
    const { queue } = queueForService(serviceId);
    const waiting = entries.findWaiting(queue.id, actor.id);
    if (!waiting) throw notInQueue();
    const { entry, canceledAs } = cancelEntry(actor, waiting.id);
    return { entry: toA3Entry(entry, serviceId, canceledAs) };
  }

  function statusByService(actor, serviceId) {
    const { service, queue } = queueForService(serviceId);
    const entry = entries.findWaiting(queue.id, actor.id);
    if (!entry) throw notInQueue();
    return toA3Status(entry, service);
  }

  function adminQueueByService(serviceId) {
    const { service, queue } = queueForService(serviceId);
    return entries.listWaiting(queue.id).map(entry => toA3Status(entry, service));
  }

  function serveNextByService(admin, serviceId) {
    const { queue } = queueForService(serviceId);
    return { entry: toA3Entry(serveNext(admin, queue.id), serviceId) };
  }

  function waitingEntryInService(serviceId, entryId) {
    const { queue } = queueForService(serviceId);
    const entry = entries.findById(entryId);
    if (entry?.queueId !== queue.id || entry.status !== 'waiting') throw entryNotFound();
    return entry;
  }

  function setPriorityByService(admin, serviceId, entryId, priority) {
    waitingEntryInService(serviceId, entryId);
    setEntryPriority(admin, entryId, PRIORITY_TO_LEVEL[priority]);
    return adminQueueByService(serviceId);
  }

  function removeByService(admin, serviceId, entryId) {
    waitingEntryInService(serviceId, entryId);
    const { entry, canceledAs } = cancelEntry(admin, entryId);
    return { entry: toA3Entry(entry, serviceId, canceledAs) };
  }

  return {
    joinQueue, joinInTransaction, cancelEntry, cancelInTransaction, serveNext, serveInTransaction,
    setEntryPriority, setPriorityInTransaction, getEntryStats,
    joinByService, leaveByService, statusByService,
    adminQueueByService, serveNextByService, setPriorityByService, removeByService,
    hydrate, settled, toA3Entry,
  };
}

module.exports = { PRIORITY_LEVELS, createQueueEntryService };