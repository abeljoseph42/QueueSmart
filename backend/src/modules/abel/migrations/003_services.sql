-- Migration 003: services (owner: Abel). Applied by Nik's migration runner.
CREATE TABLE service (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  expected_duration_minutes INTEGER NOT NULL
    CHECK (typeof(expected_duration_minutes) = 'integer' AND expected_duration_minutes BETWEEN 1 AND 480),
  priority_level INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(priority_level) = 'integer' AND priority_level IN (0, 1, 2)),
  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(is_active) = 'integer' AND is_active IN (0, 1))
);

CREATE INDEX idx_service_is_active ON service (is_active);
