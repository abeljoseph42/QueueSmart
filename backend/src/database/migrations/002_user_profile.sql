CREATE TABLE user_profile (
  email TEXT PRIMARY KEY NOT NULL,

  full_name TEXT NOT NULL
    CHECK (length(full_name) BETWEEN 1 AND 100)
    CHECK (full_name = trim(full_name)),

  phone TEXT
    CHECK (
      phone IS NULL OR (
        length(phone) BETWEEN 1 AND 30
        AND phone = trim(phone)
      )
    ),

  preferences_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      CASE WHEN json_valid(preferences_json)
        THEN json_type(preferences_json) = 'object'
          AND length(CAST(preferences_json AS BLOB)) <= 4096
        ELSE 0
      END
    ),

  FOREIGN KEY (email)
    REFERENCES user_credentials(email)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) STRICT;