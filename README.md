# QueueSmart

QueueSmart is a smart queue management application developed across A1
(architecture), A2 (frontend), and A3 (backend and API integration).

The A3 implementation includes authentication, service management, user queue
operations, administrator queue controls, wait estimates, in-app notifications,
and participation history. The React frontend calls the Express backend.

All application data is held in memory. Restarting the backend clears registered
users, sessions, services, queue entries, history, and notifications. A configured
demo administrator is recreated at startup. No database is required for A3.

## Technology

- Frontend: JavaScript, React, Vite, and React Router.
- Backend: Node.js, Express, Zod, and an in-memory store.
- Testing: Jest and Supertest with coverage thresholds.
- Integration: REST APIs, Bearer sessions, and a shared frontend request helper.

Use Node.js 22.13 or newer compatible runtime and npm. Install the locked
versions with `npm ci` in each application folder.

## Team contributions

Nik Nambisseril - Shared foundation; registration, login, sessions, roles, services, demo admin, shared frontend API helper, and auth/service screen integration
Abel Joseph - Event subscribers, notifications, participation history, user dashboard, and related frontend integration
Bryan Biju - Join, leave, queue status, ordering, wait estimates, near-event helpers, and queue screen integration
Heera Shetty - Admin dashboard, queue reads, open/close, serve, remove/reorder, and admin screen integration |

Each feature includes backend tests. Reviewed A3 contributions were merged through
PRs #9–#13.

## Run locally

### Backend

From the repository root:

```sh
cd backend
npm ci
```

If `backend/.env` does not exist, copy `backend/.env.example` to it. Keep the
existing file if you already have local settings. Optional demo admin variables
must both be set in `.env` using your own values:

- `DEMO_ADMIN_EMAIL`: a valid email address.
- `DEMO_ADMIN_PASSWORD`: a password of 8–128 characters.

Uncomment those variables only in your local `.env`. Without either variable,
startup creates no administrator. Partial or invalid admin configuration prevents
startup. Public registration always creates a regular user.

From `backend/`:

```sh
npm start
```

For automatic restart during development, use `npm run dev` instead.
Default API URL: `http://localhost:3001/api`.
Health check: `http://localhost:3001/api/health`.

### Frontend

Open another terminal at the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite. The backend allows frontend origin
`http://localhost:5173` by default. If Vite uses another port, update
`FRONTEND_ORIGIN` in `backend/.env` and restart the backend.

The API helper defaults to `http://localhost:3001/api`. To use another API URL,
set `VITE_API_BASE_URL` in an optional `frontend/.env.local`, then restart Vite.
Vite variables are public frontend configuration; never put passwords or server
secrets in them. Keep actual credentials out of committed files.

## Use the application

1. Start the backend and frontend.
2. Log in as the configured demo administrator and create services.
3. Register a regular user, then log in to join and leave service queues.
4. Use Queue Status to view position and wait estimates.
5. Use the admin pages to open/close, reorder, remove, and serve queue entries.
6. View user notifications on the dashboard and terminal outcomes in History.

Use separate browser sessions for administrator and user demonstrations.
Session tokens expire after one hour. After a backend restart, log in again;
regular accounts and services must also be recreated.

Queue Status polls every ten seconds. User Dashboard and History load when opened.
Admin pages load when opened and refresh their own data after relevant admin
mutations. Other-client changes may require a browser refresh or revisiting a page.

## Verify the application

From `backend/`:

```sh
npm run check
npm audit
```

From `frontend/`:

```sh
npm run lint
npm run build
npm audit
```

See [the validation record](backend/docs/VALIDATION.md) for recorded results and
remaining manual checks. Passing automated tests does not replace a combined
admin/user browser demonstration.

## Repository structure

- `frontend/src/api/`: shared request helper and feature API functions.
- `frontend/src/pages/`: auth, user, and admin screens.
- `backend/src/app.js`: application factory and shared dependency composition.
- `backend/src/server.js`: startup, optional demo admin, and shutdown.
- `backend/src/modules/`: feature modules for Nik, Abel, Bryan, and Heera.
- `backend/src/shared/`: schemas, store, events, and errors.
- `backend/tests/`: unit and API tests.

## Documentation and scope

- [Backend guide](backend/README.md)
- [API reference](backend/docs/API.md)
- [Validation record](backend/docs/VALIDATION.md)
- [Original foundation Git workflow](backend/docs/GIT_WORKFLOW.md)

The Git workflow document includes historical setup steps. The foundation is
already published: current feature work should branch from updated main and use
reviewed pull requests rather than repeat initial setup.

A3 does not include database persistence, real email/SMS, appointments, or external
calendar integration. Visible logout, role-aware navigation, and additional
refresh controls remain possible usability improvements. The navbar's A2 demo
label is also a remaining presentation cleanup.