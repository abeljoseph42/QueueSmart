# Database migrations

Use NNN_description.sql, for example 001_user_credentials.sql.

Reserved migration numbers:

- 001: credentials — Nik
- 002: profiles — Nik
- 003: services — Abel
- 004: queues — Abel
- 005: entries — Bryan
- 006: appointments — Heera
- 007: notifications — Heera

All migrations run inside the runner's transaction.

Do not include BEGIN, COMMIT, PRAGMA journal_mode, or VACUUM
inside migration files.

Never change or remove an applied migration.
Add a later migration instead.

Do not apply a later migration before its reserved predecessors
are available.

Stage 1 intentionally creates only schema_migrations.
Application tables will be added in subsequent stages.