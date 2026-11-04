CREATE TABLE appointment (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (length(id) = 36),

  user_id TEXT NOT NULL
    REFERENCES user_credentials (id) ON DELETE RESTRICT,

  service_id TEXT NOT NULL
    REFERENCES service (id) ON DELETE RESTRICT,

  -- UTC instants, stored as YYYY-MM-DDTHH:MM:SS.sssZ so text order is time order.
  starts_at TEXT NOT NULL
    CHECK (length(starts_at) = 24)
    CHECK (starts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  ends_at TEXT NOT NULL
    CHECK (length(ends_at) = 24)
    CHECK (ends_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'canceled', 'completed')),

  created_at TEXT NOT NULL
    CHECK (length(created_at) = 24)
    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  updated_at TEXT NOT NULL
    CHECK (length(updated_at) = 24)
    CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),

  CHECK (ends_at > starts_at)
) STRICT;

-- Backstop for the repository's overlap check: one live appointment per service start time.
-- Canceled appointments free their slot.
CREATE UNIQUE INDEX idx_appointment_service_slot
  ON appointment (service_id, starts_at)
  WHERE status <> 'canceled';

CREATE INDEX idx_appointment_user_starts ON appointment (user_id, starts_at);
CREATE INDEX idx_appointment_service_starts ON appointment (service_id, starts_at);
