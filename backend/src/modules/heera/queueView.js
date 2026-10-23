const c = require('../../shared/contracts');
const { EVENTS } = require('../../shared/events');
// TEMPORARY stand-in until Bryan's shared order helper lands; swap this for it then.
const rank = { high: 0, medium: 1, low: 2 };
const compare = (a, b) => rank[a.priority] - rank[b.priority]
  || a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id);
function getOrderedWaiting(store, serviceId) {
  const service = store.services.get(serviceId);
  return [...store.queueEntries.values()]
    .filter(entry => entry.serviceId === serviceId && entry.status === 'waiting')
    .sort(compare)
    .map((entry, i) => ({ entry: c.queueEntry.parse(entry), position: i + 1,
      estimatedWaitMinutes: i * service.expectedDurationMinutes }));
}
// nearNotifiedAt is a server-held dedup marker (stripped by queueEntry.parse); agree its name
// and where this runs with Bryan, since his join flow needs the same near notification.
function notifyNear(store, events, serviceId) {
  for (const { entry } of getOrderedWaiting(store, serviceId).slice(0, 2)) {
    const stored = store.queueEntries.get(entry.id);
    if (stored.nearNotifiedAt) continue;
    const updated = { ...stored, nearNotifiedAt: new Date().toISOString() };
    store.queueEntries.set(entry.id, updated);
    events.publish(EVENTS.NEAR, { entry: c.queueEntry.parse(updated) });
  }
}
module.exports = { getOrderedWaiting, notifyNear };
