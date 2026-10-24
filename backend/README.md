# QueueSmart A3 backend

The Express backend implements the A3 authentication, service, queue, wait-time,
notification, history, and admin modules. The A2 frontend is connected through
REST APIs. Feature routers are implemented; they no longer use 501 placeholders.

## Run and test

Use Node.js 22.13 or newer compatible runtime. From this folder:

```sh
npm ci
npm run check
npm start
```

Use `npm run dev` for watch mode, `npm test` for tests without coverage,
`npm run test:watch` during development, and `npm run test:coverage` for coverage.
The health endpoint is `GET http://localhost:3001/api/health`.

## Environment configuration

Copy `.env.example` to `.env` only if you do not already have a local `.env`.
The start and dev scripts load `.env` when it exists.

| Variable | Purpose |
| --- | --- |
| PORT | Backend port; defaults to 3001 |
| FRONTEND_ORIGIN | Allowed browser origin; defaults to http://localhost:5173 |
| DEMO_ADMIN_EMAIL | Optional administrator email |
| DEMO_ADMIN_PASSWORD | Optional administrator password, 8–128 characters |

Leave both admin variables unset to start without an administrator. Set both to
valid local values to create the demo admin at startup. Invalid or partial admin
configuration prevents startup. Never commit actual passwords; `.env` is ignored.
The committed example keeps optional admin lines commented with no password value.

## Authentication

Registration creates only role `user`; an administrator is provisioned through
server startup configuration. Passwords are salted and hashed with Node's scrypt.
Login returns a public user object and a random opaque token. Sessions expire
one hour after login and are stored in memory. Protected requests send
`Authorization: Bearer <token>`.

`requireAuth` resolves verified identity from server-held sessions. `requireRole`
checks the user's role. Invalid credentials return 401; insufficient role returns
403. Password hashes and salts are excluded from public user responses. There is
no logout/revocation endpoint in the current API.

## Architecture and feature ownership

| Location | Responsibility |
| --- | --- |
| src/app.js | Create the app, store, event bus, auth service, subscribers, and routers |
| src/server.js | Validate port, provision optional demo admin, listen, and handle shutdown |
| src/modules/nik/ | Auth service, service management, and admin bootstrap |
| src/modules/bryan/ | User queue APIs and shared queue ordering/wait helpers |
| src/modules/heera/ | Admin dashboard and queue operations |
| src/modules/abel/ | User dashboard, notifications, history, and subscribers |
| src/middleware/ | Zod request validation and identity/role guards |
| src/shared/ | Public contracts, errors, event bus, and in-memory store |

`createApp()` creates an isolated store and event bus unless supplied by the caller.
Routers reuse the same injected dependencies. Tests can inject verified identities
through `resolveUser`; the running server does not enable a browser identity bypass.

The store contains Maps named users, sessions, services, queueEntries, history,
and notifications. Everything resets on restart; no persistent database is used.
Services start open when created. Service editing preserves IDs and queue state.

## Queue behavior

- One waiting entry per user/service; the same user may join multiple services.
- Join derives identity from auth and priority from the selected service.
- Closed queues reject new joins, but existing users can leave and admins can serve.
- Automatic order uses priority, arrival time, and a stable entry-ID tie-break.
- Positions are one-based. Estimated wait is
  `(position - 1) * expectedDurationMinutes`.
- Shared queue helpers preserve manual admin reorder across reads. A newcomer
  joins after the last entry of the same priority; if none exists, it goes before
  the first lower-priority entry, or at the end.
- Terminal statuses are served, left, and removed. Terminal entries no longer
  appear in the active waiting list.

## Notifications and history

Queue mutations publish queue.joined, queue.near, queue.served, queue.left, and
queue.removed after state changes. Near events fire once per entry when it first
reaches position 1 or 2, including on join. Admin actions reuse Bryan's shared
helpers and reevaluate near events.

Abel's subscribers create one notification per entry/event type and one terminal
history record per entry. Reads are scoped to the authenticated user. Subscribers
start with the app; tests can call `app.locals.stopSubscribers()` for cleanup.

The event bus is synchronous. Subscribers must not throw for expected states or
mutate payloads. There is no durable delivery or transactional rollback.
Notifications are in-app records, not email/SMS or browser push notifications.

## Frontend integration

`frontend/src/api/client.js` exports apiRequest, saveToken, and clearSession.
The helper returns response data directly and attaches the token stored under
`queuesmart.token` in sessionStorage. Authenticated 401 responses clear that token;
the helper does not redirect automatically.

Service API records use expectedDurationMinutes. The frontend services helper
also supplies an expectedDuration alias for the existing service-management form.

See [API contracts](docs/API.md), [validation results](docs/VALIDATION.md), and the
[root guide](../README.md) for setup and combined demonstration instructions.