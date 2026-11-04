CREATE TABLE queue (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (length(id) = 36),

  service_id TEXT NOT NULL UNIQUE
    REFERENCES service (id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'closed'
    CHECK (status IN ('open', 'closed')),

  created_at TEXT NOT NULL
    CHECK (length(created_at) = 24)
    CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

-- Services created before this migration get their one queue, closed.
INSERT INTO queue (id, service_id, status, created_at)
SELECT
  lower(
    hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  id,
  'closed',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM service;
