const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../src/database/connection');
const { createStore } = require('../src/shared/store');
const { createEventBus } = require('../src/shared/events');
const { createQueueEntryService } = require('../src/modules/bryan/queueEntryService');

const { file, gate, action, actor, queueId } = workerData;
const db = openDatabase({ filename: file });
const service = createQueueEntryService({ db, store: createStore(), events: createEventBus() });
const flag = new Int32Array(gate);

Atomics.add(flag, 1, 1);
Atomics.wait(flag, 0, 0);

try {
  const entry = action === 'serve' ? service.serveNext(actor, queueId) : service.joinQueue(actor, queueId);
  parentPort.postMessage({ ok: true, entry });
} catch (error) {
  parentPort.postMessage({ ok: false, status: error.status, code: error.code });
} finally {
  db.close();
}