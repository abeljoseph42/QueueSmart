const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { withWriteTransaction } = require('../../database/connection');
const { ApiError } = require('../../shared/errors');

const NOTIFICATION_STATUSES = Object.freeze(['pending', 'sent', 'failed', 'viewed']);
const MAX_ATTEMPTS = 3;
const PAGE_SIZE = 20;

const enqueueInput = z.object({
  userId: z.uuid(),
  eventKey: z.string().trim().min(1).max(200),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/).max(50),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
}).strict();

const pageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(NOTIFICATION_STATUSES).optional(),
}).strict();

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.',
    result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })));
  return result.data;
}

const toNotification = row => row && {
  id: row.id,
  userId: row.user_id,
  eventKey: row.event_key,
  type: row.type,
  subject: row.subject,
  message: row.message,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sentAt: row.sent_at,
  viewedAt: row.viewed_at,
};

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Notification not found.');
const errorText = error => String(error?.message || error || '').trim().slice(0, 500) || 'Delivery failed.';

// Email delivery is not wired to a real provider yet; the default sender only simulates success.
const simulatedSend = async () => {};

function createNotificationService(db, { send = simulatedSend, now = () => new Date() } = {}) {
  const inFlight = new Set();
  const stamp = () => now().toISOString();

  function findById(id, conn = db) {
    return toNotification(conn.prepare('SELECT * FROM notification WHERE id = ?').get(id)) ?? null;
  }

  function getNotification(id, conn = db) {
    const notification = findById(id, conn);
    if (!notification) throw notFound();
    return notification;
  }

  // Call inside the triggering action's write transaction, so the record commits or rolls back
  // with the action. The same eventKey always returns the first notification.
  function enqueueNotification(tx, input) {
    if (tx.isTransaction === false) throw new Error('enqueueNotification must run inside a write transaction.');
    const data = parse(enqueueInput, input);
    const existing = toNotification(tx.prepare('SELECT * FROM notification WHERE event_key = ?').get(data.eventKey));
    if (existing) {
      if (existing.userId !== data.userId) throw new ApiError(409, 'EVENT_KEY_CONFLICT',
        'This notification event already belongs to another user.');
      return { notification: existing, created: false };
    }
    const id = randomUUID();
    const at = stamp();
    tx.prepare(`INSERT INTO notification (id, user_id, event_key, type, subject, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, data.userId, data.eventKey, data.type, data.subject, data.message, at, at);
    return { notification: getNotification(id, tx), created: true };
  }

  // Claims one attempt in its own transaction, sends with no transaction open, then records the result.
  // A failed send is stored on the notification and never thrown, so the triggering action stands.
  async function deliverNotification(id) {
    if (inFlight.has(id)) return getNotification(id);
    inFlight.add(id);
    try {
      const claim = withWriteTransaction(db, tx => {
        const current = getNotification(id, tx);
        if (current.status !== 'pending') return null;
        if (current.attempts >= MAX_ATTEMPTS) {
          tx.prepare(`UPDATE notification SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`)
            .run('Delivery attempt limit reached.', stamp(), id);
          return null;
        }
        tx.prepare('UPDATE notification SET attempts = attempts + 1, updated_at = ? WHERE id = ?').run(stamp(), id);
        const { email } = tx.prepare('SELECT email FROM user_credentials WHERE id = ?').get(current.userId);
        return { email, notification: getNotification(id, tx) };
      });
      if (!claim) return getNotification(id);

      let failure = null;
      try {
        await send({ to: claim.email, subject: claim.notification.subject, text: claim.notification.message,
          notification: claim.notification });
      } catch (error) {
        failure = errorText(error);
      }

      return withWriteTransaction(db, tx => {
        const at = stamp();
        // Keep a status the user changed meanwhile (viewed); otherwise record the outcome.
        tx.prepare(`UPDATE notification SET
            status = CASE WHEN status = 'pending' THEN ? ELSE status END,
            sent_at = CASE WHEN ? THEN sent_at ELSE ? END,
            last_error = ?, updated_at = ?
          WHERE id = ?`)
          .run(failure ? 'failed' : 'sent', failure ? 1 : 0, at, failure, at, id);
        return getNotification(id, tx);
      });
    } finally {
      inFlight.delete(id);
    }
  }

  // Admin retry: only failed notifications, and never past three attempts in total.
  async function retryNotification(id) {
    withWriteTransaction(db, tx => {
      const current = getNotification(id, tx);
      if (current.status !== 'failed') throw new ApiError(409, 'INVALID_STATUS',
        `Only failed notifications can be retried; this one is ${current.status}.`);
      if (current.attempts >= MAX_ATTEMPTS) throw new ApiError(409, 'RETRY_LIMIT_REACHED',
        `This notification has already been attempted ${MAX_ATTEMPTS} times.`);
      tx.prepare(`UPDATE notification SET status = 'pending', updated_at = ? WHERE id = ?`).run(stamp(), id);
    });
    return deliverNotification(id);
  }

  // Viewing is in-app and allowed from any status; a pending notification that is viewed is not emailed.
  function markViewed(id, userId) {
    return withWriteTransaction(db, tx => {
      const current = findById(id, tx);
      if (!current || current.userId !== userId) throw notFound();
      if (current.status !== 'viewed') {
        const at = stamp();
        tx.prepare(`UPDATE notification SET status = 'viewed', viewed_at = ?, updated_at = ? WHERE id = ?`)
          .run(at, at, id);
      }
      return getNotification(id, tx);
    });
  }

  function page(where, params, options) {
    const { page: number, status } = parse(pageInput, options);
    const clauses = [...where, ...(status ? ['status = ?'] : [])];
    const values = [...params, ...(status ? [status] : [])];
    const sql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const { total } = db.prepare(`SELECT count(*) AS total FROM notification${sql}`).get(...values);
    const items = db.prepare(`SELECT * FROM notification${sql} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...values, PAGE_SIZE, (number - 1) * PAGE_SIZE).map(toNotification);
    return { items, page: number, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
  }

  // Newest first, 20 per page.
  const listForUser = (userId, options = {}) => page(['user_id = ?'], [userId], options);
  const listAll = (options = {}) => page([], [], options);

  return { enqueueNotification, deliverNotification, retryNotification, markViewed,
    findById, getNotification, listForUser, listAll };
}

module.exports = { NOTIFICATION_STATUSES, MAX_ATTEMPTS, PAGE_SIZE, createNotificationService };
