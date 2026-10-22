# QueueSmart A3 backend foundation

This is the shared starting point, not the completed A3 backend. It adds a sibling
`backend/` to the existing React/Vite `frontend/`. Do not replace the frontend or
its package files. No database, email, calendar, or GitHub connection is required.

The public repository was inspected at main commit
`c9cdd526967a431d0802b4a3b5255f52ba96fca5`. The root contained `frontend/` and
`README.md`; frontend code uses JavaScript, React, Vite, and React Router, with
separate auth/user/admin pages. The root README still describes placeholders,
although merged feature commits exist; inspect the actual screens when integrating.
This package has not been merged into that repository or tested with its frontend.

## Run and verify

Use Node.js 22.13 or newer in the 22 release line (or a newer compatible release).
From the repository root:

```sh
cd backend
npm ci
npm run check
npm run dev
```

Visit `http://localhost:3001/api/health` for `{"data":{"status":"ok"}}`.
Use a second terminal to run the existing frontend with its own `npm ci` and
`npm run dev`. Default allowed frontend origin is `http://localhost:5173`.
Optionally copy `.env.example` to `.env` and adjust PORT/FRONTEND_ORIGIN.
Use `npm start` without watch mode. Use `npm test`, `npm run test:watch`, or
`npm run test:coverage` for tests. Commit `package-lock.json`; ignore node_modules,
coverage, logs, and actual environment files.

## Architecture and boundaries

- `src/app.js`: app factory; tests import it without opening a listening port.
- `src/server.js`: process startup and shutdown only.
- `src/shared/contracts.js`: executable Zod request and response models.
- `src/shared/store.js`: a fresh in-memory store per app instance; no shared globals.
- `src/shared/events.js`: an app-local event bus with validated queue payloads.
- `src/shared/errors.js`: stable JSON error format and 404/501 handling.
- `src/middleware/`: validation, verified identity extension point, role guard.
- `src/modules/{nik,abel,bryan,heera}/router.js`: pre-mounted owner routers.
- `tests/`: shared infrastructure, validation, and route boundary tests.

The A1 API-server, Queue Service, and Notification Manager responsibilities remain
separate logical modules. A3 substitutes memory for the A1 database boundary.
Appointment, external email, and calendar adapters remain future extension points:
they are in A1 but are not required by the supplied A3 module list. Do not add real
integrations or database persistence during this setup.

Each store collection is a Map keyed by opaque string ID. Collections are `users`,
`sessions`, `services`, `queueEntries`, `history`, and `notifications`.
Response models are public DTOs: password hashes and session records belong only
in internal storage. Use `crypto.randomUUID()` for new IDs and UTC ISO timestamps.
Empty stores are intentional; there are no fake login accounts or admin passwords.

## What currently works

Health, CORS configuration, JSON parsing limits, request validation, error handling,
role enforcement, store/event isolation, and `/api/auth/me` with an injected verified
identity resolver. Feature handlers return 501 after their guards and validators.
Default authentication returns 401 for every protected route. Registration and
login do not create users or sessions yet. No test-only identity bypass is enabled
in the running server. This is deliberate scaffolding behavior.

Nik supplies a production resolver through `createApp({ resolveUser })`. It must
verify the token or session and return a public user DTO or null. Roles must come
from server-held data, never browser headers or public registration input. Keep
passwords out of responses; hash passwords and use opaque, expiring session tokens
when implementing authentication.

## Ownership and staged work

| Member | Primary backend files | Meaningful implementation stages |
| --- | --- | --- |
| Nik | `src/modules/nik/` | Registration/login and auth tests; verified identity resolver; service create/list; service editing and validation tests |
| Abel | `src/modules/abel/` | User-scoped event subscribers; notification creation/listing; history tracking/listing; dashboard aggregation and tests |
| Bryan | `src/modules/bryan/` | Queue join and duplicate checks; leave/status; ordering and wait-time helpers; edge-case tests and user-screen API calls |
| Heera | `src/modules/heera/` | Admin queue/dashboard reads; open/close; serve next; remove/reorder and admin-screen API calls with tests |

Put controllers, services, and tests inside owner modules or owner-named test
files. The initial shared setup does not replace anyone's feature contribution.
Coordinate edits to app.js, middleware, contracts, lockfile, and shared tests.
All routers are mounted already; owners should not need to edit app.js for routes.

Bryan should publish ordering/wait helpers with an agreed interface for Heera to
reuse before either duplicates the algorithm. Order high, medium, low priority,
then arrival order, with a stable tie-break. Entry priority is derived by the
server from the service at join time, not chosen by the joining user. A first
waiting user's basic estimate is zero: `(position - 1) * expectedDurationMinutes`.
Reject duplicate active participation for the same user/service with 409. Different
services may each have one active participation. A closed queue rejects new joins
with 409; current entries may leave and admins may serve existing entries.

Manual admin reorder explicitly overrides automatic priority/arrival order for the
current waiting entries. Agree on stored order metadata before implementing it;
never re-sort away an administrator's successful move. Bounds violations return
400. Unknown services/entries and a missing current entry return 404. Empty serve
returns 409. Clients can only read or alter their own participation via `/me`.

Publish events only after successful mutations, including served/left/removed.
Abel owns notification/history subscribers, initialized once per app with cleanup
functions for tests. Joined creates an in-app notification; near means position
1 or 2, and should be emitted once per entry when it first crosses that threshold
(including on join). Terminal events create one history record per entry. Do not
store all users' history or notifications in a user's response. Subscriber
implementation and app wiring are still TODOs.

Coverage thresholds check the current scaffold, not A3 completion. As features are
implemented, replace 501 expectations with success/business-error tests. Retain
meaningful tests for core logic and validation; aim for the assignment's 70–80%
coverage of implemented code. The startup-only server file is excluded; feature
files are included by the coverage glob.

## Frontend integration later

Keep current A2 screens and navigation. Each owner replaces their own mock actions
with API calls after their endpoints work. For the Vite app, introduce a separate
`frontend/.env.example` with `VITE_API_BASE_URL=http://localhost:3001/api`, and a
small shared fetch helper agreed by the team. No frontend edits are included here.

Example for a completed endpoint:

```js
const base = import.meta.env.VITE_API_BASE_URL;
const response = await fetch(`${base}/services`);
const payload = await response.json();
if (!response.ok) throw new Error(payload.error.message);
const services = payload.data;
```

Authenticated calls will use the agreed verified bearer token. Never store server
secrets in VITE variables. Present 501 errors honestly during development rather
than disguising unfinished endpoints with successful mock responses.

See [API contracts](docs/API.md) and [manual Git workflow](docs/GIT_WORKFLOW.md).
