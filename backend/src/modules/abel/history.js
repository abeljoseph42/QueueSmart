const { randomUUID } = require('node:crypto');
const { EVENTS } = require('../../shared/events');

const outcomes = { [EVENTS.SERVED]: 'served', [EVENTS.LEFT]: 'left', [EVENTS.REMOVED]: 'removed' };

// One history record per entry; later terminal events for it are ignored.
function addHistory(outcome, { entry }, store) {
  const exists = [...store.history.values()].some(record => record.entryId === entry.id);
  if (exists) return;
  const record = { id: randomUUID(), entryId: entry.id, userId: entry.userId,
    serviceId: entry.serviceId, joinedAt: entry.joinedAt, endedAt: new Date().toISOString(), outcome };
  store.history.set(record.id, record);
}

const historyHandlers = Object.fromEntries(Object.entries(outcomes)
  .map(([type, outcome]) => [type, (payload, store) => addHistory(outcome, payload, store)]));

function listHistory(store, userId) {
  return [...store.history.values()]
    .filter(record => record.userId === userId)
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
}

module.exports = { historyHandlers, listHistory };
