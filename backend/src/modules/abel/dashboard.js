const { queueStatusFor } = require('../bryan/queueService');
const { listNotifications } = require('./notifications');

function getDashboard(store, userId) {
  const queues = [...store.queueEntries.values()]
    .filter(entry => entry.userId === userId && entry.status === 'waiting' && store.services.has(entry.serviceId))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map(entry => queueStatusFor(store, entry));
  return { services: [...store.services.values()], queues, notifications: listNotifications(store, userId) };
}

module.exports = { getDashboard };
