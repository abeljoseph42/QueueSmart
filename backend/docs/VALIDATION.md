# QueueSmart A3 validation record

This record replaces the original 25-test scaffold record. It separates automated
verification from manual browser checks and remaining team acceptance work.

## Verified application baseline

Application code reviewed at commit `659cff4`, containing merged A3 PRs #9–#13.
The automated checks below were run against a separate copy of that snapshot using
the same locked dependencies. They did not alter the working repository.

| Check | Recorded result |
| --- | --- |
| Backend npm run check | Passed: 16 suites, 141 tests |
| Statement coverage | 99.35% |
| Branch coverage | 99.21% |
| Function coverage | 97.45% |
| Line coverage | 99.75% |
| Frontend npm run lint | Passed |
| Frontend production build | Passed |

Coverage includes src/**/*.js except startup-only src/server.js. Enforced global
minimums are 75% branches and 80% statements, functions, and lines. High coverage
supports verification but does not prove the absence of integration defects.

## Subsequent dependency verification

PR #14 updated only frontend/package-lock.json and was merged as `9954e87`.
The frontend dependency tree now resolves Zod 4.6.7 through the React Hooks lint
plugin. For that change, the setup owner reported:

- npm ls zod: 4.6.7.
- npm audit: 0 vulnerabilities reported at the time of the check.
- npm run lint: passed.
- npm run build: passed with Vite 8.3.5.

Those frontend results are separate from the complete backend baseline above.
Dependency advisories can change; rerun npm audit in both folders before submission.
Do not report the older Vite-only audit warning as the current Zod finding.

## Automated test scope

- Registration, case-insensitive duplicate emails, concurrent registration,
  password hashing, credential failures, role restrictions, and session expiry.
- Verified Bearer identities, missing/deleted users, demo admin bootstrap, and
  admin login followed by service creation.
- Service listing, creation, editing, strict validation, missing resources,
  admin access, and preservation of service IDs and queue state.
- Joining, leaving, current status, duplicate/closed-queue conflicts, user/service
  isolation, priority ordering, stable ties, wait estimates, and manual reorder.
- Admin metrics, queue state, serve/remove/reorder operations, and event effects.
- Once-only near events, notification deduplication, terminal history,
  user-scoped reads, dashboard aggregation, and subscriber wiring/cleanup.
- Shared request validation, error sanitization, CORS/health, malformed or
  oversized JSON, event payloads, and isolated stores.

Most feature API tests use injected verified identities and controlled fixtures.
Separate auth API tests exercise real sessions. Backend tests are not automated
browser tests. There is no automated frontend browser-test suite in this record.

## Manual checks already reported

The setup owner reported passing the following checks on the auth/services branch
before the complete team's frontend integration was merged:

- Admin login succeeds; wrong credentials display an error; a stopped backend
  displays a connection error.
- Registration redirects to login with email filled in; the new account can log
  in; duplicate email and empty name are rejected visibly.
- Service listing, creation, editing, browser-refresh retention while the backend
  stays running, and failed-save feedback when the backend is stopped.

These results do not establish that the final combined browser flow has passed.

## Remaining team acceptance checks

Record tester, actual tested commit, date, and result after running each check
against the latest merged version. Leave these pending until actually performed.

| Check | Tester | Commit and date | Result |
| --- | --- | --- | --- |
| Admin creates a service; regular user registers, logs in, and joins | Pending | Pending | Pending |
| Multiple users get consistent positions and wait estimates | Pending | Pending | Pending |
| Admin serve, remove, and reorder update the user queue status | Pending | Pending | Pending |
| Joined/near/terminal notifications and matching history appear | Pending | Pending | Pending |
| Closed queue blocks new joins; existing entries may leave or be served | Pending | Pending | Pending |
| Missing/expired sessions and regular-user admin access show appropriate feedback | Pending | Pending | Pending |
| Two users cannot read or alter each other's participation/history | Pending | Pending | Pending |
| Backend restart resets data and old tokens fail as documented | Pending | Pending | Pending |

Use separate browser sessions for users and administrator. Refresh pages that do
not poll. Queue Status polls every ten seconds. No database, real email/SMS,
calendar, or appointment integration is required for this A3 scope.

## Reproduce checks

From backend/: run npm ci, npm run check, and npm audit.
From frontend/: run npm ci, npm run lint, npm run build, and npm audit.

For the manual demonstration, run npm start in backend/ and npm run dev in
frontend/ using separate terminals. Configure demo credentials only in the ignored
backend/.env. Never include passwords or session tokens in submitted evidence.