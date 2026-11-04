CREATE TABLE service (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (length(id) = 36),

  name TEXT NOT NULL
    CHECK (length(name) BETWEEN 1 AND 100)
    CHECK (name = trim(name)),

  description TEXT NOT NULL DEFAULT ''
    CHECK (length(description) <= 1000),

  expected_duration_minutes INTEGER NOT NULL
    CHECK (expected_duration_minutes BETWEEN 1 AND 480),

  priority_level INTEGER NOT NULL DEFAULT 0
    CHECK (priority_level IN (0, 1, 2)),

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0, 1))
) STRICT;

CREATE INDEX idx_service_is_active ON service (is_active);
