const { randomUUID } = require('node:crypto');
const { ApiError } = require('../../shared/errors');
const { EVENTS } = require('../../shared/events');


function findService(store, serviceId) {
  const service = store.services.get(serviceId);
  if (!service) throw new ApiError(404, 'NOT_FOUND', 'Service not found.');
  return service;
}

function findActiveEntry(store, serviceId, userId) {
  for (const entry of store.queueEntries.values()) {
    if (entry.serviceId === serviceId && entry.userId === userId && entry.status === 'waiting') return entry;
  }
  return undefined;
}

function waitingEntries(store, serviceId) {
  return [...store.queueEntries.values()]
    .filter(entry => entry.serviceId === serviceId && entry.status === 'waiting')
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

function queueStatusFor(store, entry) {
  const service = findService(store, entry.serviceId);
  const position = waitingEntries(store, entry.serviceId).findIndex(e => e.id === entry.id) + 1;
  return { entry: { ...entry }, position, estimatedWaitMinutes: (position - 1) * service.expectedDurationMinutes };
}

function joinQueue({ store, events }, { serviceId, userId }) {
  const service = findService(store, serviceId);
  if (!service.isOpen) throw new ApiError(409, 'QUEUE_CLOSED', 'This queue is closed to new joins.');
  if (findActiveEntry(store, serviceId, userId)) {
    throw new ApiError(409, 'ALREADY_IN_QUEUE', 'You are already waiting in this queue.');
  }
  
  const entry = {
    id: randomUUID(),
    serviceId,
    userId,
    priority: service.priority,
    joinedAt: new Date().toISOString(),
    status: 'waiting',
  };
  store.queueEntries.set(entry.id, entry);
  events.publish(EVENTS.JOINED, { entry: { ...entry } }); 
  return queueStatusFor(store, entry);
}

function requireActiveEntry(store, serviceId, userId) {
  findService(store, serviceId);
  const entry = findActiveEntry(store, serviceId, userId);
  if (!entry) throw new ApiError(404, 'NOT_IN_QUEUE', 'You are not waiting in this queue.');
  return entry;
}

function getMyStatus({ store }, { serviceId, userId }) {
  return queueStatusFor(store, requireActiveEntry(store, serviceId, userId));
}

function leaveQueue({ store, events }, { serviceId, userId }) {
  const entry = requireActiveEntry(store, serviceId, userId);
  entry.status = 'left';
  events.publish(EVENTS.LEFT, { entry: { ...entry } });
  return { entry: { ...entry } };
}

module.exports = { findService, findActiveEntry, waitingEntries, queueStatusFor, joinQueue,
  requireActiveEntry, getMyStatus, leaveQueue };