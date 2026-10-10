# Everest Backend

Node.js + Express 5 + MongoDB (Mongoose) API for the Everest Textile Manufacturing System.
Modular monolith: `route → controller → service → model`. Business rules live in services.

## Setup

Requirements: **Node.js ≥ 20.19.0**, a MongoDB **replica set** (MongoDB Atlas is one by default).

```bash
cd backend
npm ci                   # exact versions from package-lock.json
cp .env.example .env     # then set MONGODB_URI and JWT_SECRET (see below)
npm run seed:dev         # optional: one user per role (needs SEED_PASSWORD in .env)
npm run dev              # watch mode, pretty logs, http://localhost:4000
```

Generate a `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> **Why a replica set?** Inventory reservation (Phase 3) uses multi-document transactions
> (e.g. "reserve stock" + "write audit event" must succeed or fail together). A standalone
> `mongod` rejects transactions. Atlas clusters, including the free tier, are replica sets.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `node --watch` + `pino-pretty` human-readable logs |
| `npm start` | Production start, JSON logs on stdout |
| `npm test` | Jest (native ESM) against an in-memory MongoDB replica set |
| `npm run test:watch` | Same, in watch mode |
| `npm run seed:dev` | Creates `admin@`, `store@`, `floor@`, `qc@`, `buyer@everest.local`, all with `SEED_PASSWORD`. Idempotent, never overwrites a password, **refuses in production** |
| `npm run bootstrap:admin` | Creates the **first** admin from `BOOTSTRAP_ADMIN_*`. Works in production; refuses while an active admin exists; never promotes an existing account |

The first `npm test` downloads a `mongod` binary (~100 MB) into the npm cache; it needs internet once.

### Environment variables

Validated at startup by `src/config/env.js`. If anything is invalid the server prints every bad
variable **by name** (never its value) and exits with code 1.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | yes | — | `mongodb://` or `mongodb+srv://`; must be a replica set |
| `JWT_SECRET` | yes | — | ≥ 32 characters. Changing it logs everyone out |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | Vite uses 5173 |
| `LOG_LEVEL` | no | `info` (`silent` in test) | `fatal` `error` `warn` `info` `debug` `trace` `silent` |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated list of allowed browser origins |
| `JSON_BODY_LIMIT` | no | `100kb` | Larger bodies get `413 PAYLOAD_TOO_LARGE` |
| `JWT_EXPIRES_IN` | no | `8h` | `<number><s\|m\|h\|d>`; one shift |
| `BCRYPT_ROUNDS` | no | `12` | 4–15; **≥ 10 in production** |

Script-only (the server ignores them): `SEED_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`,
`BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`.

If MongoDB is unreachable at startup the server exits with code 1 within ~5 seconds
(`serverSelectionTimeoutMS = 5000`).

## API contract (for the frontend)

Base URL in development: `http://localhost:4000/api`

### Every response uses one envelope

Branch on `success`. Never on HTTP status text, never on `message` text.

**Success**

```json
{ "success": true, "data": { }, "meta": { } }
```

- `data` is always present (may be `null`).
- `meta` is optional (pagination: `{ page, limit, total }`).
- `201` is used when a resource is created.

**Failure**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Human-readable, safe to show",
    "details": { },
    "requestId": "72bab0d6-5ebc-4682-a712-ccba7e673091"
  }
}
```

- `code` is stable and machine-readable: **switch on it**. `message` may be reworded.
- `details` is optional; its shape depends on the code (see below).
- `data` is never present on failure.
- Stack traces and internal error messages are never returned, in any environment.

### Request id

Every response carries an `X-Request-Id` header (exposed to the browser via CORS). Errors also
include it as `error.requestId`. Show it in error toasts / include it in bug reports: the backend
logs can be searched for that exact request (authenticated requests also log the `userId`).

A client may send its own `X-Request-Id` (e.g. an offline-queue event id). It is reused only if it
matches `^[A-Za-z0-9-]{8,64}$`; otherwise the server generates a UUID.

## Authentication & authorization

### How to call a protected endpoint

1. `POST /api/auth/login` with email and password → receive `data.token`.
2. Send it on every request: `Authorization: Bearer <token>`.
3. On any `401`, drop the token and go to the login screen.

There is **no public registration**. Accounts are created by an ADMIN (`POST /api/users`).
For local development run `npm run seed:dev`.

### 401 vs 403: handle them differently

| Status | Meaning | Codes | Frontend should |
|---|---|---|---|
| **401** | "We don't know who you are" — no token, invalid/forged/expired token, or the account was deactivated | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` (login only) | Clear the token, redirect to login. For `TOKEN_EXPIRED` you may say "Your session expired" |
| **403** | "We know who you are; your role may not do this" | `FORBIDDEN` | Keep the session, show "No access". **Do not** redirect to login: logging in again cannot fix it |

Notes:
- A deactivated user's existing token stops working on their **next request** (401), because the
  backend re-reads the user on every request. Role changes also apply on the next request.
- An **unknown `/api` route returns 401** to an anonymous caller (so routes cannot be probed) and
  **404** to an authenticated one. Paths outside `/api` return 404.
- `403` messages are deliberately generic and do not list which roles would be allowed.

### Token facts

- HS256 JWT, valid for **8 hours** (one shift). **No refresh token:** log in again after expiry.
- **Trade-off:** a stolen token works until it expires, *unless* the user is deactivated or their
  `tokenVersion` is bumped (deactivation does this), which kills all their tokens at once.
- The payload contains only the user id (`sub`) and a token version (`tv`). **Do not read the role
  from the token**; get it from the login response or `GET /api/auth/me`.
- Storage is the frontend's choice. `localStorage` survives reloads but is readable by any XSS;
  in-memory is safer but lost on reload. Never put the token in a URL.

### Roles

`STORE_KEEPER`, `FLOOR_MANAGER`, `QC_INSPECTOR`, `BUYER`, `ADMIN`

### Permission matrix (Phase 2)

| Endpoint | STORE_KEEPER | FLOOR_MANAGER | QC_INSPECTOR | BUYER | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| `POST /api/auth/login` | public | public | public | public | public |
| `GET /api/auth/me` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GET /api/users` | | | | | ✓ |
| `POST /api/users` | | | | | ✓ |
| `PATCH /api/users/:id/status` | | | | | ✓ |

The same table is enforced by `tests/integration/rbac.matrix.test.js`.

### User object

Every endpoint that returns a user returns exactly this shape (never a password hash):

```json
{
  "id": "6ac9e694fb5b7a4251e49549",
  "name": "Everest Admin",
  "email": "admin@everest.local",
  "role": "ADMIN",
  "isActive": true,
  "lastLoginAt": "2026-10-10T07:17:41.029Z",
  "createdAt": "2026-10-10T07:17:40.931Z"
}
```

## Endpoints

### `GET /api/health` — public

Readiness check. `200` only when the API can serve data; `503 SERVICE_UNAVAILABLE` otherwise.

```bash
curl -i http://localhost:4000/api/health
```

```json
{ "success": true, "data": { "status": "ok", "db": "connected", "uptimeSeconds": 3 } }
```

### `POST /api/auth/login` — public, rate-limited

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@everest.local","password":"<SEED_PASSWORD>"}'
```

Request body: `email` (string, case-insensitive), `password` (string, ≤ 72 bytes).

`200 OK` (response has `Cache-Control: no-store`):

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs…",
    "tokenType": "Bearer",
    "expiresAt": "2026-10-10T15:17:41.000Z",
    "user": {
      "id": "6ac9e694fb5b7a4251e49549",
      "name": "Everest Admin",
      "email": "admin@everest.local",
      "role": "ADMIN",
      "isActive": true,
      "lastLoginAt": "2026-10-10T07:17:41.029Z",
      "createdAt": "2026-10-10T07:17:40.931Z"
    }
  }
}
```

Errors:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing/malformed email, missing password, password > 72 bytes |
| 401 | `INVALID_CREDENTIALS` | Unknown email, wrong password **or** deactivated account — deliberately indistinguishable |
| 429 | `TOO_MANY_REQUESTS` | Too many attempts (see rate limits); `Retry-After` header + `details.retryAfterSeconds` |

```json
{
  "success": false,
  "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password", "requestId": "fdfa1281-…" }
}
```

**Rate limits** (15-minute window):
- 5 **failed** attempts per email from the same IP → that email is blocked from that IP (even with
  the right password) until the window resets. Successful logins don't count.
- 100 attempts of any kind per IP. Generous because all factory tablets share one public IP.

```json
{
  "success": false,
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Too many login attempts. Please wait and try again.",
    "requestId": "43e987a1-…",
    "details": { "retryAfterSeconds": 900 }
  }
}
```

### `GET /api/auth/me` — any authenticated role

```bash
curl -s http://localhost:4000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

`200 OK`: `{ "success": true, "data": { "user": { …User object… } } }`

Errors: `401 UNAUTHENTICATED` / `401 TOKEN_EXPIRED`.

### `POST /api/users` — ADMIN

Creates an account of any role (including another ADMIN). The creator is recorded.

```bash
curl -s -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Meena Iyer","email":"meena@everest.local","password":"Weaving-Floor-2026","role":"QC_INSPECTOR"}'
```

| Field | Rule |
|---|---|
| `name` | 2–100 characters |
| `email` | valid email, stored lowercased, unique |
| `password` | 10 characters minimum, 72 **bytes** maximum |
| `role` | one of the five roles (uppercase) |

Any other field (`isActive`, `passwordHash`, …) is rejected with 400.

`201 Created`: `{ "success": true, "data": { "user": { …User object, "lastLoginAt": null… } } }`

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid field or unknown field (`details` lists each) |
| 401 | `UNAUTHENTICATED` | No/invalid token |
| 403 | `FORBIDDEN` | Caller is not ADMIN (returned before validation) |
| 409 | `DUPLICATE_RESOURCE` | Email already exists (case-insensitive); `details.fields: ["email"]` |

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "d0e4dd38-…",
    "details": [
      { "location": "body", "path": "name", "message": "Too small: expected string to have >=2 characters" },
      { "location": "body", "path": "email", "message": "Invalid email address" },
      { "location": "body", "path": "password", "message": "Too small: expected string to have >=10 characters" },
      { "location": "body", "path": "role", "message": "Invalid option: expected one of \"STORE_KEEPER\"|\"FLOOR_MANAGER\"|\"QC_INSPECTOR\"|\"BUYER\"|\"ADMIN\"" }
    ]
  }
}
```

### `GET /api/users` — ADMIN

Query: `role` (optional), `isActive=true|false` (optional), `page` (default 1), `limit` (1–100, default 50).
Newest first.

```bash
curl -s "http://localhost:4000/api/users?role=QC_INSPECTOR&limit=10" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": { "users": [ { …User object… }, { …User object… } ] },
  "meta": { "page": 1, "limit": 10, "total": 2 }
}
```

Errors: `400` (bad query), `401`, `403`.

### `PATCH /api/users/:id/status` — ADMIN

Body: `{ "isActive": false }` or `{ "isActive": true }` (boolean, nothing else).

```bash
curl -s -X PATCH http://localhost:4000/api/users/6ac9e69580929200ec1aee4c/status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"isActive":false}'
```

`200 OK`: `{ "success": true, "data": { "user": { …User object, "isActive": false… } } }`

State transitions:

```
ACTIVE ──deactivate──▶ INACTIVE   all existing tokens revoked at once; login refused
INACTIVE ──activate──▶ ACTIVE     can log in again; old tokens stay revoked
(same status again)               no-op, 200
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed id, missing/non-boolean `isActive`, extra fields |
| 401 / 403 | | Not authenticated / not ADMIN |
| 404 | `NOT_FOUND` | No user with that id |
| 409 | `CANNOT_DEACTIVATE_SELF` | An admin tried to deactivate their own account |
| 409 | `LAST_ACTIVE_ADMIN` | Would leave no active admin (only reachable when two admins deactivate each other at the same moment) |

### Unknown route

```bash
curl -i http://localhost:4000/api/yarns                         # 401 UNAUTHENTICATED (anonymous)
curl -i http://localhost:4000/api/yarns -H "Authorization: Bearer $TOKEN"   # 404 NOT_FOUND
```

## Error codes

Rule: **400** = the request itself is wrong. **409** = the request is well-formed but conflicts with
the current factory state. No `422` is used anywhere.

| Code | HTTP | Meaning | Frontend should |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing/invalid/unknown field, bad id format | Highlight fields from `details` |
| `INVALID_JSON` | 400 | Body is not valid JSON | Treat as a client bug |
| `UNAUTHENTICATED` | 401 | No/invalid token, or account deactivated/revoked | Drop token, go to login |
| `TOKEN_EXPIRED` | 401 | Genuine token past its 8h lifetime | "Session expired", go to login |
| `INVALID_CREDENTIALS` | 401 | Login failed (any reason) | "Invalid email or password" |
| `FORBIDDEN` | 403 | Role not allowed | Show "no access"; do not log out |
| `NOT_FOUND` | 404 | Route or resource does not exist | Show not-found state |
| `CONFLICT` | 409 | Request conflicts with current state | Show `message`, refresh data |
| `DUPLICATE_RESOURCE` | 409 | A unique value already exists | Show which `details.fields` clash |
| `CANNOT_DEACTIVATE_SELF` | 409 | Admin targeted own account | Show `message` |
| `LAST_ACTIVE_ADMIN` | 409 | Would leave no active admin | Show `message` |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds `JSON_BODY_LIMIT` | Reduce payload |
| `TOO_MANY_REQUESTS` | 429 | Login rate limit | Wait `details.retryAfterSeconds` |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Generic error + `requestId` |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable | Retry later (offline queue may retry) |

Domain codes are added with their phase and will be listed here, e.g. `INSUFFICIENT_STOCK` (409),
`INVALID_STATE_TRANSITION` (409), `ALREADY_DISPATCHED` (409). They are **not available yet**.

### Example bodies for the other errors

**404 NOT_FOUND**

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Route not found: GET /nope", "requestId": "72bab0d6-…" }
}
```

**400 INVALID_JSON** / **413 PAYLOAD_TOO_LARGE** / **500 INTERNAL_ERROR** follow the same shape with
messages `Request body is not valid JSON`, `Request body is too large`, `An unexpected error occurred`.

**503 SERVICE_UNAVAILABLE**

```json
{
  "success": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Database is not connected",
    "details": { "db": "disconnected" },
    "requestId": "…"
  }
}
```

## Project structure

```
src/
  app.js            createApp(): middleware + routes, no listen/DB (testable)
  server.js         process entry: config → DB → listen → graceful shutdown
  config/           env (zod-validated), db connection, logger
  constants/        roles
  models/           Mongoose models (User)
  validators/       zod request schemas
  services/         business rules: auth, users, password hashing, tokens
  middleware/       requestLogger, authenticate, authorize, rateLimit, validate, notFound, errorHandler
  routes/           URL → handler mapping; index.js mounts everything under /api
  controllers/      HTTP in/out only, no business rules
  scripts/          logic behind the seed/bootstrap CLIs (importable, tested)
  utils/            AppError, errorCodes, apiResponse (envelope)
scripts/            CLI entry points: seed-dev-users.js, bootstrap-admin.js
tests/
  setup/            in-memory replica set + test secrets for the whole run
  helpers/          createTestUser, bearer(), captureLogs()
  unit/             pure logic and middleware
  integration/      app, database, auth, users, RBAC matrix, scripts, real server process
```

### Conventions

- Throw `new AppError('CODE', 'message', { details })` from services. Never pick an HTTP status
  in a service; it is derived from the code in `src/utils/errorCodes.js`.
- Every route after `router.use(authenticate)` in `routes/index.js` requires a token. Each route
  declares its roles with `authorize(ROLES.X, ...)` **before** `validate(...)`, and is added to the
  RBAC matrix test.
- Validate input with `validate({ params, query, body })` (zod); controllers read **`req.validated`**
  only. Use `z.strictObject` for bodies that create or change state.
- Never return a model directly: map it through a public-shape function (e.g. `toPublicUser`).
- Respond with `sendSuccess(res, data, { status, meta })`.

## Known limitations

- **Login rate limits are in memory**: they reset on restart and are per process. Running more than
  one backend process would need a shared store (e.g. Redis).
- **Reverse proxy**: if deployed behind a proxy, Express's `trust proxy` must be configured, or
  every request appears to come from the proxy's IP (breaking rate limiting).
- `npm audit` reports moderate advisories in `sprintf-js`, pulled in by Jest's coverage tooling.
  Dev-only, never shipped; the suggested "fix" downgrades Jest to v25, so it is not applied.
  Runtime dependencies: `npm audit --omit=dev` reports 0 vulnerabilities.
- The graceful-shutdown (SIGTERM) test is skipped on Windows, which cannot deliver POSIX signals
  to a child process. It runs on Linux/macOS/CI.
