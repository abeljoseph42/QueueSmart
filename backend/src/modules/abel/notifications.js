const { randomUUID } = require('node:crypto');
const { EVENTS } = require('../../shared/events');

const messages = {
  [EVENTS.JOINED]: name => `You joined the ${name} queue.`,
  [EVENTS.NEAR]: name => `You're almost up in the ${name} queue.`,
  [EVENTS.SERVED]: name => `You have been served at ${name}.`,
  [EVENTS.LEFT]: name => `You left the ${name} queue.`,
  [EVENTS.REMOVED]: name => `You were removed from the ${name} queue.`,
};

// One notification per entry and event type, so repeated events add nothing.
function addNotification(type, { entry }, store) {
  const exists = [...store.notifications.values()]
    .some(n => n.entryId === entry.id && n.type === type);
  if (exists) return;
  const name = store.services.get(entry.serviceId)?.name ?? 'service';
  const notification = { id: randomUUID(), userId: entry.userId, entryId: entry.id,
    type, message: messages[type](name), createdAt: new Date().toISOString() };
  store.notifications.set(notification.id, notification);
}

const notificationHandlers = Object.fromEntries(Object.keys(messages)
  .map(type => [type, (payload, store) => addNotification(type, payload, store)]));

function listNotifications(store, userId) {
  return [...store.notifications.values()]
    .filter(n => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

module.exports = { notificationHandlers, listNotifications };
