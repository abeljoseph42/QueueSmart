# QueueSmart A4: Database Setup and Nik's Handoff

## Completed scope

Nik Nambisseril implemented:

- SQLite connection configuration and synchronous write transactions.
- Versioned SQL migrations with checksum verification.
- Credentials and profile tables with database constraints.
- Atomic creation of credentials and profiles.
- Persistent registration, login, and administrator bootstrap.
- Salted scrypt password hashing and safe public user responses.
- Authenticated profile retrieval and editing.
- A frontend profile page with validation and persistence.
- Database, authentication, profile, and API tests.

## Setup from a clean checkout

Use Node.js 22.13 or newer compatible runtime.

From the repository root:

```sh
cd backend
npm ci
```

If .env does not exist, copy .env.example to .env.
Preserve an existing .env and keep credentials out of Git.

The default database path is:

```text
backend/data/queuesmart.sqlite
```

QUEUESMART_DB_PATH may override this path. Relative paths resolve from backend/,
independently of the terminal's working directory.

Initialize the database and start the backend:

```sh
npm run db:migrate
npm start
```

Startup also applies pending migrations. Repeated migration runs skip completed
files. Do not delete the local database to apply normal schema changes.

In another terminal, from the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite.

A separate teammate should verify these instructions from a clean checkout.
That verification has not yet been recorded here.

## Administrator setup

Configure both DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD in the ignored backend/.env.

- Neither configured: no administrator is provisioned.
- Partial or invalid configuration: startup fails.
- New administrator: credentials and profile are created atomically.
- Existing administrator: reused without resetting its password.
- Existing regular user with the configured email: startup refuses promotion.

Changing DEMO_ADMIN_PASSWORD after provisioning does not reset the stored password.

## Database conventions

- Foreign keys enabled on each connection.
- WAL journal mode.
- Busy timeout: 5000 milliseconds.
- Write helper: withWriteTransaction(db, callback).
- Callbacks must be synchronous.
- Email delivery must happen outside database transactions.
- Lock contention maps to HTTP 503 DATABASE_BUSY.
- Prepared statements bind application values.

## Existing migrations

| Migration | Owner | Purpose |
| --- | --- | --- |
| 001_user_credentials.sql | Nik | Authentication records |
| 002_user_profile.sql | Nik | Profile records linked by email |

Reserved next migrations:

| Number | Owner | Purpose |
| --- | --- | --- |
| 003 | Abel | Services |
| 004 | Abel | Queues |
| 005 | Bryan | Queue entries |
| 006 | Heera | Appointments |
| 007 | Heera | Notifications |

Use NNN_description.sql filenames.

Never edit, rename, or remove an applied migration. Add a later migration instead.
The runner rejects changed, missing, duplicate-version, or out-of-order migrations.

Apply reserved migrations in order. Migration files must not contain their own
BEGIN/COMMIT, PRAGMA journal_mode, or VACUUM statements.

## Authentication compatibility

Public API roles remain user/admin.
Database roles are User/Administrator; the repository maps between them.

Passwords retain the existing salted scrypt implementation. This supersedes the
earlier planning document's Argon2 choice.

The password_hash column stores the algorithm identifier, salt, and hash together.
Password material is excluded from API responses.

Public registration cannot select an administrator role.
Duplicate emails retain the existing HTTP 409 EMAIL_IN_USE response.

Sessions remain in memory and expire after one hour. After a backend restart,
accounts remain available, but users must log in again.

## Profile API

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | /api/me/profile | Return the authenticated user's profile |
| PATCH | /api/me/profile | Update allowed profile fields |

PATCH accepts one or more of:

- name: trimmed string, 1-100 characters.
- phone: trimmed string, 1-30 characters, or null to clear.
- preferences: JSON object, at most 4096 UTF-8 bytes.

Omitted fields remain unchanged. A supplied preferences object replaces the
previous preferences object.

Email, role, IDs, and unknown fields cannot be edited through this endpoint.
The server derives ownership from the authenticated session.

The frontend page is available at /profile through My Profile.
It edits name and phone and displays read-only email and account type.

## Verification reported for this work

| Check | Reported result |
| --- | --- |
| SQLite foundation tests | 11 passed |
| Credentials/profile schema tests | 25 passed |
| Database authentication tests | 16 passed |
| Profile tests | 21 passed |
| Complete backend suite | 20 suites, 214 tests passed |
| Statement coverage | 99.15% |
| Branch coverage | 97.32% |
| Function coverage | 97.93% |
| Line coverage | 99.43% |
| Frontend lint | Passed |
| Frontend production build | Passed |

These are recorded results from the implementation checks, not a new test run
for this documentation commit.

Current coverage configuration excludes startup-only src/server.js.
Global configured minimums are 75% branches and 80% statements/functions/lines.
The reported results exceed 80% in all four measures.

Manual browser checks reported as passed:

1. Log in and open My Profile.
2. Confirm saved account details appear.
3. Save an updated name and phone.
4. Refresh and confirm those changes remain.
5. Clear the phone, save, and confirm it remains blank after refresh.
6. Restart the backend, log in again, and confirm the updated name remains.

## Contribution evidence

| Stage | Implementation commit | Merged PR |
| --- | --- | --- |
| Database foundation | 5410c00 | #16 |
| Credentials/profile schemas | 99b2cfc | #17 |
| Persistent registration/login | 15af425 | #18 |
| Profile API and frontend | 23dc762 | #19 |

Repository: https://github.com/abeljoseph42/QueueSmart

## Remaining team work

The completed user/profile module does not establish completion of the entire A4.

Remaining integrations include services, queues, queue entries, appointments,
notification/history persistence, and relevant UI/statistics integration.

Real email and calendar integration are not implemented by Nik's work.

Each owner must add meaningful implementation and tests, then rerun combined
coverage after merging. Final submission evidence must reflect the final team
revision rather than reuse these intermediate results unchanged.

The final Word/PDF submission must include the repository link, complete database
schema, final coverage evidence, and actual contributions for all four members.