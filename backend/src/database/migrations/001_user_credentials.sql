CREATE TABLE user_credentials (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (length(id) = 36),

  email TEXT NOT NULL UNIQUE
    CHECK (length(email) BETWEEN 3 AND 254)
    CHECK (email = lower(trim(email))),

  password_hash TEXT NOT NULL
    CHECK (length(password_hash) BETWEEN 1 AND 512),

  role TEXT NOT NULL DEFAULT 'User'
    CHECK (role IN ('User', 'Administrator'))
) STRICT;