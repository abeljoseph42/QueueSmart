CREATE TABLE notification (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (length(id) = 36),

  user_id TEXT NOT NULL
    REFERENCES user_credentials (id) ON DELETE RESTRICT,

  -- Names the triggering event, e.g. appointment.booked:<appointment id>.
  -- Enqueueing the same key again returns the existing notification.
  event_key TEXT NOT NULL UNIQUE
    CHECK (length(event_key) BETWEEN 1 AND 200),

  type TEXT NOT NULL
    CHECK (length(type) BETWEEN 1 AND 50),

  subject TEXT NOT NULL
    CHECK (length(subject) BETWEEN 1 AND 200),

  message TEXT NOT NULL
    CHECK (length(message) BETWEEN 1 AND 2000),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'viewed')),

  -- Email delivery attempts, including admin retries. Three at most.
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 3),

  last_error TEXT
    CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 500),

  created_at TEXT NOT NULL
    CHECK (length(created_at) = 24)
    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  updated_at TEXT NOT NULL
    CHECK (length(updated_at) = 24)
    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  sent_at TEXT
    CHECK (sent_at IS NULL OR (length(sent_at) = 24 AND sent_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')),

  viewed_at TEXT
    CHECK (viewed_at IS NULL OR (length(viewed_at) = 24 AND viewed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')),

  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status <> 'viewed' OR viewed_at IS NOT NULL)
) STRICT;

CREATE INDEX idx_notification_user_created ON notification (user_id, created_at);
CREATE INDEX idx_notification_status_created ON notification (status, created_at);
