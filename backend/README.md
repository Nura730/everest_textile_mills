# Everest Backend

Node.js + Express 5 + MongoDB (Mongoose) API for the Everest Textile Manufacturing System.
Modular monolith: `route → controller → service → model`. Business rules live in services.

## Setup

Requirements: **Node.js ≥ 20.19.0**, a MongoDB **replica set** (MongoDB Atlas is one by default).

```bash
cd backend
npm install
cp .env.example .env     # then set MONGODB_URI
npm run dev              # watch mode, pretty logs, http://localhost:4000
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

The first `npm test` downloads a `mongod` binary (~100 MB) into the npm cache; it needs internet once.

### Environment variables

Validated at startup by `src/config/env.js`. If anything is invalid the server prints every bad
variable **by name** (never its value) and exits with code 1.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | yes | — | `mongodb://` or `mongodb+srv://`; must be a replica set |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | Vite uses 5173 |
| `LOG_LEVEL` | no | `info` (`silent` in test) | `fatal` `error` `warn` `info` `debug` `trace` `silent` |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated list of allowed browser origins |
| `JSON_BODY_LIMIT` | no | `100kb` | Larger bodies get `413 PAYLOAD_TOO_LARGE` |

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
- `meta` is optional (pagination etc.).
- `201` is used when a resource is created.

**Failure**

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
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
logs can be searched for that exact request.

A client may send its own `X-Request-Id` (e.g. an offline-queue event id). It is reused only if it
matches `^[A-Za-z0-9-]{8,64}$`; otherwise the server generates a UUID.

### Error codes

Rule: **400** = the request itself is wrong. **409** = the request is well-formed but conflicts with
the current factory state. No `422` is used anywhere.

| Code | HTTP | Meaning | Frontend should |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing/invalid field, bad id format | Highlight fields from `details` |
| `INVALID_JSON` | 400 | Body is not valid JSON | Treat as a client bug |
| `UNAUTHENTICATED` | 401 | No/expired/invalid token *(Phase 2)* | Redirect to login |
| `FORBIDDEN` | 403 | Logged in, but role not allowed *(Phase 2)* | Show "no access"; do not retry |
| `NOT_FOUND` | 404 | Route or resource does not exist | Show not-found state |
| `CONFLICT` | 409 | Request conflicts with current state | Show `message`, refresh data |
| `DUPLICATE_RESOURCE` | 409 | A unique value already exists | Show which `details.fields` clash |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds `JSON_BODY_LIMIT` | Reduce payload |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Generic error + `requestId` |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable | Retry later (offline queue may retry) |

Domain codes are added with their phase and will be listed here, e.g. `INSUFFICIENT_STOCK` (409),
`INVALID_STATE_TRANSITION` (409), `ALREADY_DISPATCHED` (409).

### Example response per error kind

**400 VALIDATION_ERROR** (`details` = one entry per invalid field)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "location": "body", "path": "quantity", "message": "Too small: expected number to be >0" }
    ],
    "requestId": "0c1d135e-65f1-4467-80f6-1b47cf903af8"
  }
}
```

**400 INVALID_JSON**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body is not valid JSON",
    "requestId": "0c1d135e-65f1-4467-80f6-1b47cf903af8"
  }
}
```

**401 UNAUTHENTICATED** *(from Phase 2)*

```json
{
  "success": false,
  "error": { "code": "UNAUTHENTICATED", "message": "Authentication required", "requestId": "…" }
}
```

**403 FORBIDDEN** *(from Phase 2)*

```json
{
  "success": false,
  "error": { "code": "FORBIDDEN", "message": "You do not have access to this resource", "requestId": "…" }
}
```

**404 NOT_FOUND**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found: GET /api/yarns",
    "requestId": "72bab0d6-5ebc-4682-a712-ccba7e673091"
  }
}
```

**409 CONFLICT** (domain codes such as `INSUFFICIENT_STOCK` follow the same shape)

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 400 kg of Cotton/Navy is available.",
    "details": { "available": 400, "requested": 850 },
    "requestId": "…"
  }
}
```

**409 DUPLICATE_RESOURCE** (field names only, never the duplicated value)

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_RESOURCE",
    "message": "A record with the same unique value already exists",
    "details": { "fields": ["email"] },
    "requestId": "…"
  }
}
```

**413 PAYLOAD_TOO_LARGE**

```json
{
  "success": false,
  "error": { "code": "PAYLOAD_TOO_LARGE", "message": "Request body is too large", "requestId": "…" }
}
```

**500 INTERNAL_ERROR** (the real error is only in the server log, under this `requestId`)

```json
{
  "success": false,
  "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred", "requestId": "…" }
}
```

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

### Endpoints

#### `GET /api/health`

Readiness check. `200` only when the API can serve data; `503 SERVICE_UNAVAILABLE` otherwise.

```bash
curl -i http://localhost:4000/api/health
```

```
HTTP/1.1 200 OK
X-Request-Id: fb036985-5ed2-4a59-a682-634fa7782791

{ "success": true, "data": { "status": "ok", "db": "connected", "uptimeSeconds": 3 } }
```

#### Unknown route → 404

```bash
curl -i http://localhost:4000/api/yarns
```

```
HTTP/1.1 404 Not Found
X-Request-Id: 72bab0d6-5ebc-4682-a712-ccba7e673091

{ "success": false, "error": { "code": "NOT_FOUND", "message": "Route not found: GET /api/yarns", "requestId": "72bab0d6-5ebc-4682-a712-ccba7e673091" } }
```

Sending your own request id:

```bash
curl -i -H "X-Request-Id: tablet-07-req-0001" http://localhost:4000/api/yarns
# → X-Request-Id: tablet-07-req-0001, error.requestId: "tablet-07-req-0001"
```

## Project structure

```
src/
  app.js            createApp(): middleware + routes, no listen/DB (testable)
  server.js         process entry: config → DB → listen → graceful shutdown
  config/           env (zod-validated), db connection, logger
  middleware/       requestLogger, validate, notFound, errorHandler
  routes/           URL → handler mapping; index.js mounts everything under /api
  controllers/      HTTP in/out only, no business rules
  utils/            AppError, errorCodes, apiResponse (envelope)
tests/
  setup/            in-memory replica set for the whole run
  unit/             pure logic and middleware
  integration/      app, database, real server process
```

`services/`, `repositories/`, `models/` and the other layers are added by the phase that first needs them.

### Conventions

- Throw `new AppError('CODE', 'message', { details })` from services. Never pick an HTTP status
  in a service; it is derived from the code in `src/utils/errorCodes.js`.
- Validate input with `validate({ params, query, body })` (zod) on the route; controllers read
  **`req.validated`** only (Express 5 makes `req.query` read-only).
- Respond with `sendSuccess(res, data, { status, meta })`.

## Known limitations

- `npm audit` reports moderate advisories in `sprintf-js`, pulled in by Jest's coverage tooling.
  Dev-only, never shipped; the suggested "fix" downgrades Jest to v25, so it is not applied.
  Runtime dependencies: `npm audit --omit=dev` reports 0 vulnerabilities.
- The graceful-shutdown (SIGTERM) test is skipped on Windows, which cannot deliver POSIX signals
  to a child process. It runs on Linux/macOS/CI.
