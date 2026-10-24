# QueueSmart API reference

Base URL: `http://localhost:3001/api`. All paths below are relative to `/api`.
Send JSON with `Content-Type: application/json` when a body is required.
Protected routes require `Authorization: Bearer <token>`.

Feature routes are implemented. The unused shared notImplemented helper may still
exist in errors.js, but no feature router uses it.

## Response and error formats

Success: `{ "data": ... }`.
Failure: `{ "error": { "code": "...", "message": "...", "details": [...] } }`.
Details are optional. Validation details contain path and message. Clients should
rely on codes and paths rather than exact validation wording.

| HTTP status | Meaning |
| --- | --- |
| 200 | Successful read, login, update, or queue terminal action |
| 201 | Successful registration, service creation, or queue join |
| 400 | Invalid request, empty service update, malformed JSON, or invalid reorder |
| 401 | Missing/invalid/expired session or invalid login credentials |
| 403 | Verified user lacks the admin role |
| 404 | Unknown resource or no active queue participation |
| 409 | Duplicate email, duplicate waiting entry, closed queue, or empty serve |
| 413 | JSON body exceeds 16 KB |
| 500 | Unexpected server error; internal details are not returned |

Selected codes include VALIDATION_ERROR, INVALID_JSON, PAYLOAD_TOO_LARGE,
INVALID_CREDENTIALS, EMAIL_IN_USE, UNAUTHENTICATED, FORBIDDEN, ALREADY_IN_QUEUE,
QUEUE_CLOSED, NOT_IN_QUEUE, SERVICE_NOT_FOUND, NOT_FOUND, CONFLICT, and INTERNAL_ERROR.
Unknown-service reads/queue operations use NOT_FOUND; Nik's service-edit endpoint
uses SERVICE_NOT_FOUND. Both return 404.

## Authentication and services

| Method and path | Access | Body | Success data |
| --- | --- | --- | --- |
| GET /health | Public | None | 200: {status: "ok"} |
| POST /auth/register | Public | {name, email, password} | 201: {user, token} |
| POST /auth/login | Public | {email, password} | 200: {user, token} |
| GET /auth/me | Authenticated | None | 200: user |
| GET /services | Public | None | 200: service[] |
| POST /services | Admin | {name, description, expectedDurationMinutes, priority} | 201: service |
| PATCH /services/:serviceId | Admin | Nonempty subset of service creation fields | 200: service |

Registration always creates a regular user and also issues a session token.
The current registration screen redirects to login instead of saving that token.
Tokens expire one hour after issuance; restarting the backend invalidates all
sessions. There is no refresh-token or logout endpoint.

Service creation sets isOpen to true. Service editing preserves ID and queue
open/closed state. Change isOpen through the admin queue-state endpoint instead.

## User queue operations

| Method and path | Access | Body | Success data |
| --- | --- | --- | --- |
| POST /services/:serviceId/queue/join | Authenticated | {} | 201: queueStatus |
| GET /services/:serviceId/queue/me | Authenticated | None | 200: queueStatus |
| DELETE /services/:serviceId/queue/me | Authenticated | None | 200: {entry}, status left |

Identity comes from the verified session. Priority comes from the service at join
time. Clients cannot submit userId or priority. A duplicate waiting entry for the
same user/service returns 409, as does joining a closed queue. Missing active
participation returns 404. A user may wait in different service queues at once.

## User dashboard notifications and history

| Method and path | Access | Success data |
| --- | --- | --- |
| GET /me/dashboard | Authenticated | 200: {services: service[], queues: queueStatus[], notifications: notification[]} |
| GET /me/notifications | Authenticated | 200: notification[] |
| GET /me/history | Authenticated | 200: historyRecord[] |

Queues, notifications, and history are scoped to the authenticated user.
Notifications sort newest createdAt first; history sorts newest endedAt first.
Services in dashboard data are the available service records. There is no
notification mark-as-read endpoint in this version.

## Administrator queue operations

All routes in this table require role admin.

| Method and path | Body | Success data |
| --- | --- | --- |
| GET /admin/dashboard | None | 200: {serviceCount, waitingCount, openServiceCount} |
| GET /admin/services/:serviceId/queue | None | 200: queueStatus[] in serving order |
| PATCH /admin/services/:serviceId/queue | {isOpen: boolean} | 200: service |
| POST /admin/services/:serviceId/queue/serve-next | None | 200: {entry}, status served |
| PATCH /admin/services/:serviceId/queue/:entryId | {position: integer >= 1} | 200: queueStatus[] after reorder |
| DELETE /admin/services/:serviceId/queue/:entryId | None | 200: {entry}, status removed |

Counts include only waiting entries where applicable. Serving an empty queue
returns 409/CONFLICT. Reorder positions must be within the active queue bounds;
out-of-range positions return 400/VALIDATION_ERROR. Missing, other-service, or
terminal entries cannot be reordered or removed and return 404.

Closing a queue stops new joins but permits existing entries to leave or be served.
Reordering overrides automatic order for current entries and persists across reads.
The shared helper inserts new entries after their existing priority group, or
before the first lower-priority entry when no matching group exists.

## Request validation

- Request bodies use strict schemas; unknown fields are rejected.
- Name: trimmed, 1–100 characters.
- Email: valid format, at most 254 characters, lowercased. Frontend forms trim email
  before submission; the API email schema does not trim surrounding whitespace.
- Password: 8–128 characters; not trimmed.
- Description: trimmed, 1–1000 characters.
- expectedDurationMinutes: JSON integer from 1 to 480, not a numeric string.
- Priority: low, medium, or high.
- IDs: nonempty trimmed strings up to 100 characters.
- isOpen: JSON boolean, not a string.
- A service PATCH must contain at least one permitted field.

## Public records

| Record | Fields |
| --- | --- |
| user | id, name, email, role (user or admin) |
| service | id, name, description, expectedDurationMinutes, priority, isOpen |
| queueEntry | id, serviceId, userId, priority, joinedAt, status (waiting, served, left, removed) |
| queueStatus | entry, position (one-based), estimatedWaitMinutes (integer >= 0) |
| notification | id, userId, entryId, type, message, createdAt |
| historyRecord | id, entryId, userId, serviceId, joinedAt, endedAt, outcome (served, left, removed) |

IDs are opaque. Timestamps are UTC ISO 8601 strings. Public users exclude password
hashes, salts, and internal session records. Resolve service names through serviceId.
Source schemas: `backend/src/shared/contracts.js`.

## Internal queue events

EVENTS exports JOINED (queue.joined), NEAR (queue.near), SERVED (queue.served),
LEFT (queue.left), and REMOVED (queue.removed). Every payload is {entry: queueEntry}.
Terminal events carry the updated terminal status.

Queue mutations publish after state changes. Near is emitted once per entry upon
first reaching position 1 or 2. Subscribers create one notification per entry/type
and one history record per terminal entry. The bus is synchronous, with no durable
delivery, async-listener awaiting, or automatic rollback.

## Shared frontend helper

Import apiRequest from `frontend/src/api/client.js`. Use paths such as
`/services`, not `/api/services`. Options are method, body, and authenticated
(default true). The helper serializes body as JSON and attaches the token from
sessionStorage key `queuesmart.token`.

It returns data directly, not {data: ...}. HTTP failures throw Error objects with
message, status, code, and optional details. Network and invalid-response errors
have a message but may lack the other fields. Authenticated 401 clears the saved
token but does not navigate to login. Set authenticated: false for public calls.

The services helper maps expectedDurationMinutes to an additional expectedDuration
alias for the existing screen and maps form fields back for requests.