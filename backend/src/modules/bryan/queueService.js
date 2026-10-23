const { randomUUID } = require('node:crypto');
const c = require('../../shared/contracts');
const { ApiError } = require('../../shared/errors');
const { EVENTS } = require('../../shared/events');


const metadata = new WeakMap();
function metaFor(store) {
  if (!metadata.has(store)) metadata.set(store, { order: new Map(), near: new Set() });
  return metadata.get(store);
}

const rank = { high: 0, medium: 1, low: 2 };
const automaticOrder = (a, b) => rank[a.priority] - rank[b.priority]
  || a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id);

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


function insertIndex(entries, priority) {
  let lastSame = -1;
  for (let i = 0; i < entries.length; i += 1) if (entries[i].priority === priority) lastSame = i;
  if (lastSame >= 0) return lastSame + 1;
  const firstLower = entries.findIndex(e => rank[e.priority] > rank[priority]);
  return firstLower >= 0 ? firstLower : entries.length;
}


function waitingEntries(store, serviceId) {
  const { order } = metaFor(store);
  const waiting = new Map();
  for (const entry of store.queueEntries.values()) {
    if (entry.serviceId === serviceId && entry.status === 'waiting') waiting.set(entry.id, entry);
  }
  const ordered = (order.get(serviceId) || []).filter(id => waiting.has(id)).map(id => waiting.get(id));
  const known = new Set(ordered.map(e => e.id));
  const newcomers = [...waiting.values()].filter(e => !known.has(e.id)).sort(automaticOrder);
  for (const entry of newcomers) ordered.splice(insertIndex(ordered, entry.priority), 0, entry);
  order.set(serviceId, ordered.map(e => e.id));
  return ordered;
}


function orderedQueue(store, serviceId) {
  const service = findService(store, serviceId);
  return waitingEntries(store, serviceId).map((entry, i) => ({
    entry: c.queueEntry.parse(entry),
    position: i + 1,
    estimatedWaitMinutes: i * service.expectedDurationMinutes,
  }));
}

function queueStatusFor(store, entry) {
  return orderedQueue(store, entry.serviceId).find(status => status.entry.id === entry.id);
}


function checkNearEvents(store, events, serviceId) {
  const { near } = metaFor(store);
  for (const entry of waitingEntries(store, serviceId).slice(0, 2)) {
    if (near.has(entry.id)) continue;
    near.add(entry.id);
    events.publish(EVENTS.NEAR, { entry: c.queueEntry.parse(entry) });
  }
}


function moveEntry(store, serviceId, entryId, newPosition) {
  findService(store, serviceId);
  const ordered = waitingEntries(store, serviceId);
  const from = ordered.findIndex(e => e.id === entryId);
  if (from < 0) throw new ApiError(404, 'NOT_FOUND', 'Queue entry not found in this service.');
  if (!Number.isInteger(newPosition) || newPosition < 1 || newPosition > ordered.length) {
    throw new ApiError(400, 'INVALID_POSITION', `Position must be between 1 and ${ordered.length}.`);
  }
  const [moved] = ordered.splice(from, 1);
  ordered.splice(newPosition - 1, 0, moved);
  metaFor(store).order.set(serviceId, ordered.map(e => e.id));
  return orderedQueue(store, serviceId);
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
  events.publish(EVENTS.JOINED, { entry: c.queueEntry.parse(entry) });
  checkNearEvents(store, events, serviceId);
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
  const current = requireActiveEntry(store, serviceId, userId);
  const entry = { ...current, status: 'left' };
  store.queueEntries.set(entry.id, entry);
  const publicEntry = c.queueEntry.parse(entry);
  events.publish(EVENTS.LEFT, { entry: publicEntry });
  checkNearEvents(store, events, serviceId);
  return { entry: publicEntry };
}

module.exports = { findService, findActiveEntry, waitingEntries, orderedQueue, queueStatusFor,
  checkNearEvents, moveEntry, joinQueue, requireActiveEntry, getMyStatus, leaveQueue };