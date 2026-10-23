const { EVENTS } = require('../../shared/events');
const { notificationHandlers } = require('./notifications');

// Each handler set maps an event name to ({ entry }, store) => void.
const defaultHandlerSets = [notificationHandlers];
const active = new WeakMap();

function initQueueSubscribers({ store, events }, handlerSets = defaultHandlerSets) {
  if (active.has(events)) return active.get(events);
  const unsubscribers = Object.values(EVENTS).map(name => events.subscribe(name, payload => {
    handlerSets.forEach(handlers => handlers[name]?.(payload, store));
  }));
  const cleanup = () => {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    active.delete(events);
  };
  active.set(events, cleanup);
  return cleanup;
}

module.exports = { initQueueSubscribers };
