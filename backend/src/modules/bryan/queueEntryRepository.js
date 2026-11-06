const { randomUUID } = require('node:crypto');

const ENTRY_STATUSES = Object.freeze(['waiting', 'served', 'canceled']);
const TERMINAL_STATUSES = Object.freeze(['served', 'canceled']);
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 100;

const toEntry = row => row && {
  id: row.id,
  queueId: row.queue_id,
  userId: row.user_id,
  position: row.position,
  priorityLevel: row.priority_level,
  joinedAt: row.joined_at,
  status: row.status,
  finishedAt: row.finished_at,
};

const clampLimit = limit => {
  const value = Number.isInteger(limit) ? limit : HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.max(value, 1), HISTORY_MAX_LIMIT);
};

function createQueueEntryRepository(db, { now = () => new Date() } = {}) {
  const timestamp = () => now().toISOString();

  function findById(entryId, conn = db) {
    return toEntry(conn.prepare('SELECT * FROM queue_entry WHERE id = ?').get(entryId)) ?? null;
  }

  function findWaiting(queueId, userId, conn = db) {
    return toEntry(conn.prepare(`
      SELECT * FROM queue_entry
      WHERE queue_id = ? AND user_id = ? AND status = 'waiting'
    `).get(queueId, userId)) ?? null;
  }

  function listWaiting(queueId, conn = db) {
    return conn.prepare(`
      SELECT * FROM queue_entry
      WHERE queue_id = ? AND status = 'waiting'
      ORDER BY position, id
    `).all(queueId).map(toEntry);
  }

  function recalculatePositions(queueId, conn = db) {
    const ids = conn.prepare(`
      SELECT id FROM queue_entry
      WHERE queue_id = ? AND status = 'waiting'
      ORDER BY priority_level DESC, joined_at ASC, id ASC
    `).all(queueId).map(row => row.id);
    const update = conn.prepare('UPDATE queue_entry SET position = ? WHERE id = ? AND position <> ?');
    ids.forEach((id, index) => update.run(index + 1, id, index + 1));
    return listWaiting(queueId, conn);
  }

  function insertWaiting({ queueId, userId, priorityLevel }, conn = db) {
    const id = randomUUID();
    const { next } = conn.prepare(`
      SELECT COALESCE(MAX(position), 0) + 1 AS next
      FROM queue_entry WHERE queue_id = ? AND status = 'waiting'
    `).get(queueId);
    conn.prepare(`
      INSERT INTO queue_entry (id, queue_id, user_id, priority_level, position, joined_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'waiting')
    `).run(id, queueId, userId, priorityLevel, next, timestamp());
    recalculatePositions(queueId, conn);
    return findById(id, conn);
  }

  function finishEntry(entryId, status, conn = db) {
    if (!TERMINAL_STATUSES.includes(status)) throw new TypeError(`Invalid terminal status: ${status}`);
    const entry = findById(entryId, conn);
    if (!entry || entry.status !== 'waiting') return null;
    conn.prepare(`
      UPDATE queue_entry SET status = ?, position = 0, finished_at = ?
      WHERE id = ? AND status = 'waiting'
    `).run(status, timestamp(), entryId);
    recalculatePositions(entry.queueId, conn);
    return findById(entryId, conn);
  }

  function updatePriority(entryId, priorityLevel, conn = db) {
    const entry = findById(entryId, conn);
    if (!entry || entry.status !== 'waiting') return null;
    conn.prepare('UPDATE queue_entry SET priority_level = ? WHERE id = ?').run(priorityLevel, entryId);
    recalculatePositions(entry.queueId, conn);
    return findById(entryId, conn);
  }

  function countByStatus(conn = db) {
    return { ...conn.prepare(`SELECT
      COALESCE(SUM(status = 'waiting'), 0) AS waitingCount,
      COALESCE(SUM(status = 'served'), 0) AS servedCount,
      COALESCE(SUM(status = 'canceled'), 0) AS canceledCount
      FROM queue_entry`).get() };
  }

  function listHistory(userId, { limit, offset = 0 } = {}, conn = db) {
    return conn.prepare(`
      SELECT * FROM queue_entry
      WHERE user_id = ? AND status IN ('served', 'canceled')
      ORDER BY finished_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(userId, clampLimit(limit), Math.max(0, Number.isInteger(offset) ? offset : 0)).map(toEntry);
  }

    return {
    findById, findWaiting, listWaiting, recalculatePositions, insertWaiting, finishEntry, updatePriority,
    countByStatus, listHistory,
    };
}

module.exports = {
  ENTRY_STATUSES, TERMINAL_STATUSES, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT,
  createQueueEntryRepository,
};