// Worker for the concurrent booking test: one connection per thread, all released at once.
const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('../src/database/connection');
const { createAppointmentRepository } = require('../src/modules/heera/appointmentRepository');

const { file, now, gate, input } = workerData;
const db = openDatabase({ filename: file });
const repo = createAppointmentRepository(db, { now: () => new Date(now) });
const flag = new Int32Array(gate);

Atomics.add(flag, 1, 1);
Atomics.wait(flag, 0, 0);

try {
  parentPort.postMessage({ ok: true, appointment: repo.create(input) });
} catch (error) {
  parentPort.postMessage({ ok: false, status: error.status, code: error.code });
} finally {
  db.close();
}
