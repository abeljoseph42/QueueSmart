CREATE TABLE queue_entry (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (length(id) = 36),

  queue_id TEXT NOT NULL
    REFERENCES queue (id) ON DELETE RESTRICT,

  user_id TEXT NOT NULL
    REFERENCES user_credentials (id) ON DELETE RESTRICT,

  priority_level INTEGER NOT NULL
    CHECK (priority_level IN (0, 1, 2)),

  position INTEGER NOT NULL
    CHECK (position >= 0),

  joined_at TEXT NOT NULL
    CHECK (length(joined_at) = 24)
    CHECK (joined_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'served', 'canceled')),

  finished_at TEXT
    CHECK (
      finished_at IS NULL OR (
        length(finished_at) = 24
        AND finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
      )
    ),

  CHECK (
    (status = 'waiting' AND position >= 1 AND finished_at IS NULL)
    OR (status IN ('served', 'canceled') AND position = 0
        AND finished_at IS NOT NULL AND finished_at >= joined_at)
  )
) STRICT;

CREATE UNIQUE INDEX idx_queue_entry_one_waiting
  ON queue_entry (queue_id, user_id)
  WHERE status = 'waiting';

CREATE INDEX idx_queue_entry_waiting_order
  ON queue_entry (queue_id, status, priority_level DESC, joined_at, id);

CREATE INDEX idx_queue_entry_user_history
  ON queue_entry (user_id, finished_at DESC, id DESC);