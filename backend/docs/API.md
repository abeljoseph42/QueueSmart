# Shared API contracts

Base: `http://localhost:3001/api`. Send JSON with `Content-Type: application/json`.
Request schemas and public record schemas live in `src/shared/contracts.js`.
Use strict request bodies: unknown fields are rejected, including a role during
public registration and userId/priority during queue join.

Success envelope: `{ "data": ... }`. Errors:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed.","details":[{"path":"email","message":"Invalid email address"}]}}
```

`details` is optional; clients should depend on error code/path, not Zod wording.
Validation: 400. Missing/invalid verified session: 401. Wrong role: 403. Missing
resource: 404. Business conflict: 409. Placeholder: 501. Unexpected error: 500.
Malformed JSON: 400/INVALID_JSON; body over 16 KB: 413/PAYLOAD_TOO_LARGE.

All feature rows below currently return 501 after applicable authentication and
validation. Health works; me works only with an injected verified resolver. The
listed successful responses are contracts for the feature owners to implement.
Every protected route will eventually accept `Authorization: Bearer <token>`;
the default resolver currently accepts no credentials.

| Method / path | Access; owner | Request body | Planned success |
| --- | --- | --- | --- |
| GET `/health` | Public; shared | — | 200 `{data:{status:"ok"}}` (implemented) |
| POST `/auth/register` | Public; Nik | `{name,email,password}` | 201 `{data:{user,token}}`; creates user role only |
| POST `/auth/login` | Public; Nik | `{email,password}` | 200 `{data:{user,token}}` |
| GET `/auth/me` | Authenticated; Nik | — | 200 `{data:user}` |
| GET `/services` | Public; Nik | — | 200 `{data:service[]}` |
| POST `/services` | Admin; Nik | `{name,description,expectedDurationMinutes,priority}` | 201 `{data:service}` |
| PATCH `/services/:serviceId` | Admin; Nik | Any nonempty subset of create fields | 200 `{data:service}` |
| GET `/me/dashboard` | Authenticated; Abel | — | 200 `{data:{services:service[],queues:queueStatus[],notifications:notification[]}}` |
| GET `/me/history` | Authenticated; Abel | — | 200 `{data:historyRecord[]}` |
| GET `/me/notifications` | Authenticated; Abel | — | 200 `{data:notification[]}` |
| POST `/services/:serviceId/queue/join` | Authenticated; Bryan | `{}` | 201 `{data:queueStatus}` |
| DELETE `/services/:serviceId/queue/me` | Authenticated; Bryan | — | 200 `{data:{entry:queueEntry}}` with status left |
| GET `/services/:serviceId/queue/me` | Authenticated; Bryan | — | 200 `{data:queueStatus}` for active participation |
| GET `/admin/dashboard` | Admin; Heera | — | 200 `{data:{serviceCount,waitingCount,openServiceCount}}` |
| GET `/admin/services/:serviceId/queue` | Admin; Heera | — | 200 `{data:queueStatus[]}` in serving order |
| PATCH `/admin/services/:serviceId/queue` | Admin; Heera | `{isOpen:boolean}` | 200 `{data:service}` |
| POST `/admin/services/:serviceId/queue/serve-next` | Admin; Heera | — | 200 `{data:{entry:queueEntry}}` with status served |
| PATCH `/admin/services/:serviceId/queue/:entryId` | Admin; Heera | `{position:integer>=1}` | 200 `{data:queueStatus[]}` after reorder |
| DELETE `/admin/services/:serviceId/queue/:entryId` | Admin; Heera | — | 200 `{data:{entry:queueEntry}}` with status removed |

## Record fields

- `user`: id, name, email, role (`user` or `admin`). No passwords/hashes.
- `service`: id, name (1–100 chars), description (1–1000 chars),
  expectedDurationMinutes (integer 1–480), priority (`low`, `medium`, `high`), isOpen.
- `queueEntry`: id, serviceId, userId, priority, joinedAt (UTC ISO string), status
  (`waiting`, `served`, `left`, `removed`). Future internal order metadata is not a public DTO field.
- `queueStatus`: entry, position (one-based), estimatedWaitMinutes (integer >=0).
- `historyRecord`: id, entryId, userId, serviceId, joinedAt, endedAt, outcome
  (`served`, `left`, `removed`). Owners can join service names from serviceId.
- `notification`: id, userId, entryId, type (one of the event names below),
  message, createdAt. Mark-as-read is a later API extension; coordinate before adding it.
- Tokens are opaque strings, allocated and verified server-side. Session storage,
  expiry, logout, and admin provisioning are Nik's implementation decisions.

Email is validated, capped at 254 characters, and lowercased. Name is trimmed and
1–100 characters. Password is 8–128 characters and is not trimmed. IDs are opaque,
nonempty strings up to 100 characters; minutes and queue positions are numbers,
not strings. Creation timestamps use UTC ISO 8601.

## Events

`EVENTS` exports JOINED (`queue.joined`), NEAR (`queue.near`), SERVED
(`queue.served`), LEFT (`queue.left`), and REMOVED (`queue.removed`).
Every publish receives `{entry:queueEntry}`. Extra payload fields are not retained.

```js
const unsubscribe = events.subscribe(EVENTS.JOINED, ({ entry }) => {
  // Abel creates a notification scoped to entry.userId.
});
events.publish(EVENTS.JOINED, { entry });
unsubscribe();
```

Subscribers are synchronous; errors propagate. They must not throw or mutate the
payload. There is no durable delivery, automatic deduplication, asynchronous
listener support, or automatic rollback; those are feature concerns. Event bus
and store instances must be injected from app context, never created per request.
