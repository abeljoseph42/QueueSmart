const c = require('../../shared/contracts');
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
module.exports = { getOrderedWaiting };
