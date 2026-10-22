const { EventEmitter } = require('node:events');
const { z } = require('zod');
const { queueEntry } = require('./contracts');
const eventSchema = z.object({ entry: queueEntry });
const EVENTS = Object.freeze({ JOINED: 'queue.joined', NEAR: 'queue.near',
  SERVED: 'queue.served', LEFT: 'queue.left', REMOVED: 'queue.removed' });
function createEventBus() {
  const emitter = new EventEmitter();
  const check = name => { if (!Object.values(EVENTS).includes(name)) throw new Error(`Unknown event: ${name}`); };
  return {
    // Synchronous listeners only. Subscriber errors propagate to the caller.
    // Publish after state is committed; subscribers must not throw or mutate payloads.
    publish(name, payload) { check(name); emitter.emit(name, eventSchema.parse(payload)); },
    subscribe(name, listener) { check(name); emitter.on(name, listener); return () => emitter.off(name, listener); },
  };
}
module.exports = { EVENTS, createEventBus };
