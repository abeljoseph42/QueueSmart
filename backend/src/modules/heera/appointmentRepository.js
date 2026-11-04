const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { withWriteTransaction } = require('../../database/connection');
const { ApiError } = require('../../shared/errors');
const { createServiceRepository } = require('../abel/serviceRepository');

const APPOINTMENT_STATUSES = Object.freeze(['booked', 'canceled', 'completed']);
const MAX_DAYS_AHEAD = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const createInput = z.object({
  userId: z.uuid(),
  serviceId: z.uuid(),
  // Any ISO 8601 instant with Z or an offset; stored as UTC.
  startsAt: z.iso.datetime({ offset: true }),
}).strict();

const rescheduleInput = z.object({
  startsAt: z.iso.datetime({ offset: true }),
}).strict();

const listFilter = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
}).strict();

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
    result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  return result.data;
}

const toAppointment = row => row && {
  id: row.id,
  userId: row.user_id,
  serviceId: row.service_id,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
};

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Appointment not found.');
const conflict = message => new ApiError(409, 'SLOT_CONFLICT', message);

// Live appointments (booked or completed) hold their slot; canceled ones do not.
// Ranges are half-open, so back-to-back appointments do not overlap.
// The id check lets a reschedule ignore the appointment being moved.
const OVERLAP = "status <> 'canceled' AND starts_at < ? AND ends_at > ? AND id <> ?";

// Times are stored in UTC and shown to people in Central Time.
const centralTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'short',
});
const when = startsAt => `${centralTime.format(new Date(startsAt))} Central Time`;

// With a notification service, booking and canceling queue a notification in the same transaction
// and start the email after commit. A failed email never undoes the appointment change.
function createAppointmentRepository(db, { now = () => new Date(), notifications } = {}) {
  function writeAndNotify(work) {
    const queued = [];
    const notify = (tx, input) => {
      if (notifications) queued.push(notifications.enqueueNotification(tx, input).notification.id);
    };
    const result = withWriteTransaction(db, tx => work(tx, notify));
    queued.forEach(id => notifications.deliverAfterCommit(id));
    return result;
  }

  function findById(id, conn = db) {
    return toAppointment(conn.prepare('SELECT * FROM appointment WHERE id = ?').get(id)) ?? null;
  }

  function getAppointment(id, conn = db) {
    const appointment = findById(id, conn);
    if (!appointment) throw notFound();
    return appointment;
  }

  function validateStart(startsAt, current) {
    const start = new Date(startsAt).getTime();
    if (start <= current.getTime()) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
      [{ path: 'startsAt', message: 'Appointment must be in the future.' }]);
    if (start > current.getTime() + MAX_DAYS_AHEAD * DAY_MS) throw new ApiError(400, 'VALIDATION_ERROR',
      'Request validation failed.',
      [{ path: 'startsAt', message: `Appointment must be at most ${MAX_DAYS_AHEAD} days ahead.` }]);
    return start;
  }

  // Both checks run inside the caller's write transaction, so competing writers serialize.
  function assertSlotFree(tx, { serviceId, userId, startsAt, endsAt, ignoreId = '' }) {
    if (tx.prepare(`SELECT 1 FROM appointment WHERE service_id = ? AND ${OVERLAP}`)
      .get(serviceId, endsAt, startsAt, ignoreId)) {
      throw conflict('This time slot is already booked for the service.');
    }
    if (tx.prepare(`SELECT 1 FROM appointment WHERE user_id = ? AND ${OVERLAP}`)
      .get(userId, endsAt, startsAt, ignoreId)) {
      throw conflict('You already have an appointment at this time.');
    }
  }

  function bookableService(tx, serviceId) {
    const service = createServiceRepository(tx).getService(serviceId);
    if (!service.isActive) throw new ApiError(409, 'SERVICE_INACTIVE', 'This service is not accepting appointments.');
    return service;
  }

  const slot = (start, service) => ({
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + service.expectedDurationMinutes * 60 * 1000).toISOString(),
  });

  function create(input) {
    const data = parse(createInput, input);
    const current = now();
    const start = validateStart(data.startsAt, current);

    // The slot checks and the insert share one write lock, so competing bookings serialize.
    return writeAndNotify((tx, notify) => {
      if (!tx.prepare('SELECT 1 FROM user_credentials WHERE id = ?').get(data.userId)) {
        throw new ApiError(404, 'NOT_FOUND', 'User not found.');
      }
      const service = bookableService(tx, data.serviceId);
      const { startsAt, endsAt } = slot(start, service);
      assertSlotFree(tx, { serviceId: data.serviceId, userId: data.userId, startsAt, endsAt });

      const id = randomUUID();
      const stamp = current.toISOString();
      tx.prepare(`INSERT INTO appointment
        (id, user_id, service_id, starts_at, ends_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'booked', ?, ?)`)
        .run(id, data.userId, data.serviceId, startsAt, endsAt, stamp, stamp);
      notify(tx, { userId: data.userId, eventKey: `appointment.booked:${id}`, type: 'appointment.booked',
        subject: `Appointment booked: ${service.name}`,
        message: `Your ${service.name} appointment is booked for ${when(startsAt)}.` });
      return getAppointment(id, tx);
    });
  }

  function listByUser(userId, filter = {}, conn = db) {
    const { status } = parse(listFilter, filter);
    const where = status ? ' AND status = ?' : '';
    return conn.prepare(`SELECT * FROM appointment WHERE user_id = ?${where} ORDER BY starts_at, id`)
      .all(...[userId, status].filter(Boolean)).map(toAppointment);
  }

  function listByService(serviceId, filter = {}, conn = db) {
    const { status } = parse(listFilter, filter);
    const where = status ? ' AND status = ?' : '';
    return conn.prepare(`SELECT * FROM appointment WHERE service_id = ?${where} ORDER BY starts_at, id`)
      .all(...[serviceId, status].filter(Boolean)).map(toAppointment);
  }

  // Only booked appointments can move, and only to canceled or completed.
  // Passing userId scopes the change to that user's own appointment.
  function transition(id, next, { userId } = {}) {
    return writeAndNotify((tx, notify) => {
      const appointment = findById(id, tx);
      if (!appointment || (userId !== undefined && appointment.userId !== userId)) throw notFound();
      if (appointment.status !== 'booked') throw new ApiError(409, 'INVALID_STATUS',
        `Only booked appointments can be ${next}; this one is ${appointment.status}.`);
      tx.prepare('UPDATE appointment SET status = ?, updated_at = ? WHERE id = ?')
        .run(next, now().toISOString(), id);
      if (next === 'canceled') {
        const { name } = createServiceRepository(tx).getService(appointment.serviceId);
        const by = userId === undefined ? ' by staff' : '';
        notify(tx, { userId: appointment.userId, eventKey: `appointment.canceled:${id}`, type: 'appointment.canceled',
          subject: `Appointment canceled: ${name}`,
          message: `Your ${name} appointment for ${when(appointment.startsAt)} was canceled${by}.` });
      }
      return getAppointment(id, tx);
    });
  }

  // Moves a booked appointment to a new start, under the same rules as booking. The length is
  // recomputed from the service's current duration. Each reschedule sends its own notification.
  // Passing userId scopes the change to that user's own appointment.
  function reschedule(id, input, { userId } = {}) {
    const data = parse(rescheduleInput, input);
    const current = now();
    const start = validateStart(data.startsAt, current);

    return writeAndNotify((tx, notify) => {
      const appointment = findById(id, tx);
      if (!appointment || (userId !== undefined && appointment.userId !== userId)) throw notFound();
      if (appointment.status !== 'booked') throw new ApiError(409, 'INVALID_STATUS',
        `Only booked appointments can be rescheduled; this one is ${appointment.status}.`);
      const service = bookableService(tx, appointment.serviceId);
      const { startsAt, endsAt } = slot(start, service);
      if (startsAt === appointment.startsAt) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
        [{ path: 'startsAt', message: 'New time must differ from the current time.' }]);
      assertSlotFree(tx, { serviceId: appointment.serviceId, userId: appointment.userId, startsAt, endsAt,
        ignoreId: id });

      tx.prepare('UPDATE appointment SET starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?')
        .run(startsAt, endsAt, current.toISOString(), id);
      const by = userId === undefined ? ' by staff' : '';
      notify(tx, { userId: appointment.userId, eventKey: `appointment.rescheduled:${id}:${randomUUID()}`,
        type: 'appointment.rescheduled', subject: `Appointment rescheduled: ${service.name}`,
        message: `Your ${service.name} appointment was moved${by} from ${when(appointment.startsAt)} to ${when(startsAt)}.` });
      return getAppointment(id, tx);
    });
  }

  const cancel = (id, options) => transition(id, 'canceled', options);
  const complete = id => transition(id, 'completed');

  return { create, findById, getAppointment, listByUser, listByService, reschedule, cancel, complete };
}

module.exports = { APPOINTMENT_STATUSES, MAX_DAYS_AHEAD, createAppointmentRepository };
