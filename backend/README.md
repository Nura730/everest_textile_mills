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
| `npm run seed:dev` | Creates `admin@`, `store@`, `floor@`, `qc@`, `buyer@` and `buyer2@everest.local` (all with `SEED_PASSWORD`), buyer companies `BUY-DEV` (linked to `buyer@`) and `BUY-TPR` (linked to `buyer2@`), products `COT-NAVY-PLAIN` and `POL-WHITE-TWILL`, four yarn lots and five demo orders, all through the real services (see `docs/DEV_ACCOUNTS.md`). Idempotent, never overwrites a password, **refuses in production** |
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

### Permission matrix

| Endpoint | STORE_KEEPER | FLOOR_MANAGER | QC_INSPECTOR | BUYER | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| `POST /api/auth/login` | public | public | public | public | public |
| `GET /api/auth/me` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `GET /api/users` | | | | | ✓ |
| `POST /api/users` | | | | | ✓ |
| `PATCH /api/users/:id/status` | | | | | ✓ |
| `GET /api/yarn-lots` | ✓ | ✓ (no cost) | | | ✓ |
| `POST /api/yarn-lots` | ✓ | | | | ✓ |
| `GET /api/yarn-lots/:id` | ✓ | ✓ (no cost) | | | ✓ |
| `GET /api/yarn-lots/:id/transactions` | ✓ | ✓ | | | ✓ |
| `POST /api/yarn-lots/:id/adjustments` | | | | | ✓ |
| `GET /api/inventory/yarn-summary` | ✓ | ✓ | | | ✓ |
| `GET /api/inventory/reconciliation` | | | | | ✓ |
| `GET /api/buyers`, `GET /api/buyers/:id` | | | | | ✓ |
| `POST /api/buyers` | | | | | ✓ |
| `GET /api/products`, `GET /api/products/:id` | ✓ | ✓ | ✓ | ✓ (no yarn spec) | ✓ |
| `POST /api/products` | | | | | ✓ |
| `GET /api/orders`, `GET /api/orders/:id` | ✓ (no money) | ✓ (no money) | ✓ (no money) | ✓ own only | ✓ |
| `POST /api/orders` | | | | ✓ own company | ✓ (names buyer) |
| `POST /api/orders/:id/cancel` | | | | ✓ own | ✓ |
| `POST /api/orders/:id/reject` | | | | | ✓ |
| `GET /api/orders/:id/feasibility` | ✓ | ✓ | | | ✓ |
| `POST /api/orders/:id/confirm` | | | | | ✓ |

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
  "buyerId": null,
  "lastLoginAt": "2026-10-10T07:17:41.029Z",
  "createdAt": "2026-10-10T07:17:40.931Z"
}
```

`buyerId` is the buyer **company** a BUYER account belongs to (`null` for staff). A BUYER account
with `buyerId: null` (created before companies existed) sees no orders and cannot place any until an
admin links it.

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
| `buyerId` | **required when `role` is `BUYER`** (an existing, active buyer company id); **not allowed** for any other role |

Any other field (`isActive`, `passwordHash`, …) is rejected with 400.

`201 Created`: `{ "success": true, "data": { "user": { …User object, "lastLoginAt": null… } } }`

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid field or unknown field (`details` lists each); `buyerId` missing for a BUYER, present for staff, or not an existing company |
| 401 | `UNAUTHENTICATED` | No/invalid token |
| 403 | `FORBIDDEN` | Caller is not ADMIN (returned before validation) |
| 409 | `DUPLICATE_RESOURCE` | Email already exists (case-insensitive); `details.fields: ["email"]` |
| 409 | `BUYER_INACTIVE` | The buyer company is inactive |

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

## Idempotency (all stock-changing calls)

Every call that changes stock **must** send an `Idempotency-Key` header: 8–64 letters, digits or
hyphens. **Use a new UUID per user action** (`crypto.randomUUID()`), and **reuse the same key when
retrying that action** (timeout, network drop, offline queue).

| Situation | Result |
|---|---|
| First call | Executes; `201` |
| Same key, same body again | Nothing changes; the **original** response is returned with header `Idempotent-Replayed: true` |
| Same key, different body | `409 IDEMPOTENCY_KEY_REUSED` — generate a new key |
| No/invalid header | `400 VALIDATION_ERROR` (`details[0].location: "headers"`) |
| The call failed (4xx/5xx) | Nothing was stored; retrying with the same key runs it again |

So after a timeout the frontend never has to guess "did it go through?": retry with the same key.

## Yarn inventory

Units: quantities in **kg** (number, at most 3 decimals; stored internally as integer grams).
Money in integer **paise** (`32000` = ₹320.00). Available stock is always `totalKg − reservedKg`.

### Lot object

```json
{
  "id": "6ac9ec4caf83621b4a3f61a4",
  "lotNumber": "GRN-2026-0104",
  "material": "COTTON",
  "colour": "Navy",
  "yarnCount": "40s",
  "supplierName": "Sri Lakshmi Spinners",
  "totalKg": 1250,
  "reservedKg": 0,
  "availableKg": 1250,
  "receivedAt": "2026-10-09T05:00:00.000Z",
  "receivedBy": "6ac9ec4c180949dc12c8d1ec",
  "createdAt": "2026-10-10T07:42:04.914Z",
  "costPerKgPaise": 32000
}
```

`costPerKgPaise` is present **only for STORE_KEEPER and ADMIN**; the floor manager never receives it.
Materials: `COTTON`, `POLYESTER`, `VISCOSE`, `NYLON`, `WOOL`, `SILK`, `LINEN`, `BLEND`.

### `POST /api/yarn-lots` — receive yarn (STORE_KEEPER, ADMIN; Idempotency-Key)

```bash
curl -s -X POST http://localhost:4000/api/yarn-lots \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3f2c9a1e-5b7d-4c1a-9e8f-0123456789ab" \
  -d '{"lotNumber":"GRN-2026-0104","material":"COTTON","colour":"navy","yarnCount":"40s",
       "supplierName":"Sri Lakshmi Spinners","quantityKg":1250,"costPerKgPaise":32000,
       "receivedAt":"2026-10-09T10:30:00+05:30"}'
```

| Field | Rule |
|---|---|
| `lotNumber` | 3–40 chars, letters/digits/`/`/`-`; upper-cased; **unique** |
| `material` | one of the materials above |
| `colour` | letters, spaces, hyphens; normalised to Title Case (`navy blue` → `Navy Blue`) |
| `yarnCount` | optional, ≤ 20 chars |
| `supplierName` | 2–120 chars |
| `quantityKg` | > 0, ≤ 100,000, ≤ 3 decimals |
| `costPerKgPaise` | integer ≥ 0 |
| `receivedAt` | optional ISO 8601 with offset; not in the future; default now |

`201 Created`: `{ "success": true, "data": { "lot": { …Lot object… } } }`

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad field, unknown field, missing `Idempotency-Key` |
| 403 | `FORBIDDEN` | Not STORE_KEEPER/ADMIN |
| 409 | `DUPLICATE_RESOURCE` | Lot number exists; `details.fields: ["lotNumber"]` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key already used for a different receipt |

### `GET /api/yarn-lots` — list lots (STORE_KEEPER, FLOOR_MANAGER, ADMIN)

Query: `material`, `colour` (case-insensitive), `includeDepleted=true|false` (default false: lots with
0 kg hidden), `page`, `limit` (≤ 100). Sorted **oldest first** (use older yarn first).

```json
{ "success": true, "data": { "lots": [ { …Lot… }, { …Lot… } ] }, "meta": { "page": 1, "limit": 50, "total": 2 } }
```

### `GET /api/yarn-lots/:id` — one lot

`200`: `{ "data": { "lot": { …Lot… } } }`. `404 NOT_FOUND` if unknown.

### `GET /api/yarn-lots/:id/transactions` — the ledger behind a lot (newest first)

```json
{
  "success": true,
  "data": {
    "transactions": [
      { "id": "…", "type": "ADJUSTMENT", "yarnLotId": "…", "deltaTotalKg": -2.5, "deltaReservedKg": 0,
        "orderId": null, "reservationId": null, "runId": null, "reason": "Water damage on two cones",
        "actorId": "…", "createdAt": "2026-10-10T07:42:05.069Z" },
      { "id": "…", "type": "RECEIPT", "yarnLotId": "…", "deltaTotalKg": 1250, "deltaReservedKg": 0,
        "orderId": null, "reservationId": null, "runId": null, "reason": null,
        "actorId": "…", "createdAt": "2026-10-10T07:42:04.917Z" }
    ]
  },
  "meta": { "page": 1, "limit": 50, "total": 2 }
}
```

Types: `RECEIPT`, `ADJUSTMENT` (now); `RESERVATION`, `RESERVATION_RELEASE`, `ISSUE`, `RETURN` (Phase 4).

### `GET /api/inventory/yarn-summary` — the catalog (STORE_KEEPER, FLOOR_MANAGER, ADMIN)

Stock grouped by material and colour across all lots. Query: `material`, `includeDepleted`.

```json
{
  "success": true,
  "data": {
    "summary": [
      { "material": "COTTON", "colour": "Navy", "lots": 2, "totalKg": 1650, "reservedKg": 0,
        "availableKg": 1650, "oldestReceivedAt": "2026-10-09T05:00:00.000Z" }
    ]
  }
}
```

### `POST /api/yarn-lots/:id/adjustments` — correct stock (ADMIN; Idempotency-Key)

Body: `{ "deltaKg": -2.5, "reason": "Water damage on two cones" }` — `deltaKg` non-zero, ±100,000,
≤ 3 decimals; `reason` 5–500 chars.

`201`: `{ "data": { "lot": { …Lot after… }, "transaction": { …ADJUSTMENT row… } } }`

A lot can never go below what is reserved for orders (or below 0):

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Adjustment would leave less stock than is reserved for orders",
    "requestId": "…",
    "details": { "totalKg": 1247.5, "reservedKg": 850, "maxReductionKg": 397.5, "requestedDeltaKg": -500 }
  }
}
```

### `GET /api/inventory/reconciliation` — prove the numbers (ADMIN)

Recomputes every lot's balances from its ledger.

```json
{ "success": true, "data": { "checkedAt": "…", "lotsChecked": 2, "balanced": true, "mismatches": [] } }
```

A mismatch looks like
`{ "lotId", "lotNumber", "issues": ["TOTAL_MISMATCH" | "RESERVED_MISMATCH" | "INVARIANT_VIOLATED" | "LEDGER_WITHOUT_LOT"], "stored": { "totalKg", "reservedKg" }, "ledger": { "totalKg", "reservedKg", "entries" } }`.

## Buyers, products and orders

Units: order quantities in **metres** (number, at most 2 decimals; stored as integer cm). Money in
integer **paise** (`18000` = ₹180.00 per metre). Deadlines are **calendar dates** `YYYY-MM-DD`.

### Buyer object

```json
{
  "id": "6aca0138c330ed1ed243ade5",
  "code": "BUY-SRT",
  "name": "Surat Fabrics Pvt Ltd",
  "contactName": "Priya Shah",
  "email": "orders@suratfabrics.example",
  "phone": "+91 98250 12345",
  "address": "Ring Road, Surat, Gujarat",
  "isActive": true,
  "createdAt": "2026-10-10T09:11:20.451Z"
}
```

### `POST /api/buyers` — create a buyer company (ADMIN)

```bash
curl -s -X POST http://localhost:4000/api/buyers -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"buy-srt","name":"Surat Fabrics Pvt Ltd","contactName":"Priya Shah",
       "email":"orders@suratfabrics.example","phone":"+91 98250 12345","address":"Ring Road, Surat, Gujarat"}'
```

| Field | Rule |
|---|---|
| `code` | 2–20 letters/digits/`-`, upper-cased, **unique** |
| `name` | 2–120 chars |
| `contactName`, `email`, `phone`, `address` | optional |

`201`: `{ "data": { "buyer": { …Buyer object… } } }`. `409 DUPLICATE_RESOURCE` (`fields: ["code"]`) if the code exists.
Then create the buyer's login with `POST /api/users` and `"role": "BUYER", "buyerId": "<buyer id>"`.

### `GET /api/buyers`, `GET /api/buyers/:id` (ADMIN)

Query: `isActive=true|false`, `page`, `limit`. Sorted by name. `404` for an unknown id.

### Product object

```json
{
  "id": "6aca0138c330ed1ed243ade7",
  "code": "COT-NAVY-PLAIN",
  "name": "Navy Cotton Plain",
  "material": "COTTON",
  "colour": "Navy",
  "weave": "PLAIN",
  "widthCm": 150,
  "gsm": 110,
  "machineType": "WEAVING",
  "pricePerMetrePaise": 18000,
  "isActive": true,
  "createdAt": "2026-10-10T09:11:20.478Z",
  "yarnGramsPerMetre": 170
}
```

`yarnGramsPerMetre` (yarn consumed per metre, including process waste) is **not sent to buyers**.

### `POST /api/products` — add a catalog fabric (ADMIN)

```bash
curl -s -X POST http://localhost:4000/api/products -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"cot-navy-plain","name":"Navy Cotton Plain","material":"COTTON","colour":"navy",
       "weave":"PLAIN","widthCm":150,"gsm":110,"yarnGramsPerMetre":170,"pricePerMetrePaise":18000}'
```

| Field | Rule |
|---|---|
| `code` | 2–30 letters/digits/`-`, upper-cased, **unique** |
| `material` | same list as yarn |
| `colour` | normalised to Title Case |
| `weave` | `PLAIN`, `TWILL`, `SATIN`, `DOBBY` |
| `widthCm` | integer 50–400 |
| `gsm` | integer 20–1000 (grams per m²) |
| `yarnGramsPerMetre` | integer, **at least gsm × width / 100** (the fabric's own weight per metre) |
| `machineType` | optional, default `WEAVING` |
| `pricePerMetrePaise` | integer ≥ 1 |

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "c9ed3e22-…",
    "details": [
      { "location": "body", "path": "yarnGramsPerMetre",
        "message": "must be at least 165 (the fabric's own weight per metre: gsm × width)" }
    ]
  }
}
```

### `GET /api/products`, `GET /api/products/:id` (all roles)

Query: `material`, `colour`, `page`, `limit`; `includeInactive=true` works for ADMIN only — everyone
else always gets active products, and an inactive product's detail is `404` for them.

### Order object

What each role receives:

| Field | BUYER (own orders) | ADMIN | STORE_KEEPER / FLOOR_MANAGER / QC_INSPECTOR |
|---|:-:|:-:|:-:|
| id, orderNumber, status, buyer, product, quantityMetres, requiredBy, buyerNotes, statusHistory, timestamps | ✓ | ✓ | ✓ |
| `pricePerMetrePaise`, `orderValuePaise` | ✓ | ✓ | |
| `requiredYarnKg`, `createdBy`, `statusHistory[].by` | | ✓ | ✓ |
| `feasibility`, `confirmedBy` (both `null` until confirmed) | | ✓ | ✓ |

As seen by the buyer:

```json
{
  "id": "6aca0138c330ed1ed243adeb",
  "orderNumber": "ORD-2026-0001",
  "status": "ORDER_CREATED",
  "buyer": { "id": "6aca0138c330ed1ed243ade5", "code": "BUY-SRT", "name": "Surat Fabrics Pvt Ltd" },
  "product": { "id": "6aca0138c330ed1ed243ade7", "code": "COT-NAVY-PLAIN", "name": "Navy Cotton Plain",
               "material": "COTTON", "colour": "Navy" },
  "quantityMetres": 5000,
  "requiredBy": "2026-11-09",
  "buyerNotes": "Pack in 100 m rolls",
  "statusHistory": [
    { "from": null, "to": "ORDER_CREATED", "at": "2026-10-10T09:11:20.583Z", "byRole": "BUYER", "reason": null }
  ],
  "createdAt": "2026-10-10T09:11:20.591Z",
  "updatedAt": "2026-10-10T09:11:20.591Z",
  "pricePerMetrePaise": 18000,
  "orderValuePaise": 90000000
}
```

The same order for ADMIN additionally has `"requiredYarnKg": 850`, `"createdBy": "…"`, `"by"` on each
history entry, and `"feasibility"` / `"confirmedBy"` (see confirmation below). For the floor manager:
the same internal fields — but no price or value. A buyer sees that an order is `CONFIRMED`, never the
factory's stock figures behind the decision.

Product and price are **copied onto the order** when it is created; editing the catalog later never
changes an existing order.

### Order statuses

```
ORDER_CREATED ──confirm (ADMIN, feasibility must pass)──▶ CONFIRMED
ORDER_CREATED ──cancel (owning BUYER or ADMIN)──────────▶ CANCELLED
ORDER_CREATED ──reject (ADMIN)──────────────────────────▶ REJECTED
CONFIRMED     ──cancel (owning BUYER or ADMIN)──────────▶ CANCELLED
```

Only these transitions exist today. The later statuses (`MATERIAL_RESERVED`, `IN_PRODUCTION`,
`PRODUCTION_COMPLETED`, `READY_FOR_DISPATCH`, `DISPATCHED`, `INVOICED`) arrive with their phases. Any
other change returns `409 INVALID_STATE_TRANSITION`.

### `POST /api/orders` — place an order (BUYER, ADMIN; Idempotency-Key)

As a buyer (the company comes from your account; **do not send `buyerId`**):

```bash
curl -s -X POST http://localhost:4000/api/orders -H "Authorization: Bearer $BUYER_TOKEN" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $(node -e "console.log(crypto.randomUUID())")" \
  -d '{"productId":"6aca0138c330ed1ed243ade7","quantityMetres":5000,"requiredBy":"2026-11-09",
       "buyerNotes":"Pack in 100 m rolls"}'
```

As an admin (phone order), add `"buyerId": "<buyer company id>"` (required).

| Field | Rule |
|---|---|
| `productId` | an existing, active product |
| `quantityMetres` | > 0, ≤ 1,000,000, ≤ 2 decimals |
| `requiredBy` | `YYYY-MM-DD`, **after today** (India time), at most 2 years ahead |
| `buyerNotes` | optional, ≤ 500 chars |
| `buyerId` | ADMIN only, required for ADMIN |

Anything else — `status`, `orderNumber`, prices, `buyerId` from a buyer — is rejected with 400.

`201`: `{ "data": { "order": { …Order object… } } }`

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad/unknown field, missing Idempotency-Key, product or buyer id that does not exist (`details[].message: "does not exist"`) |
| 403 | `FORBIDDEN` | Role not allowed, or a BUYER account not linked to a company |
| 409 | `PRODUCT_INACTIVE` / `BUYER_INACTIVE` | Retired product / inactive company |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key already used for a different order |

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "requestId": "401d331c-…",
    "details": [
      { "location": "body", "path": "quantityMetres", "message": "must have at most 2 decimal places" },
      { "location": "body", "path": "requiredBy", "message": "must be after today" }
    ]
  }
}
```

### `GET /api/orders` (all roles; BUYER sees own only)

Query: `status`, `productId`, `buyerId` (ignored for buyers), `page`, `limit`. Newest first.

```json
{ "success": true, "data": { "orders": [ { …Order… } ] }, "meta": { "page": 1, "limit": 10, "total": 1 } }
```

### `GET /api/orders/:id` (all roles; BUYER own only)

Another company's order returns **404 `NOT_FOUND`** (exactly like a missing order), never 403.

### `POST /api/orders/:id/cancel` (owning BUYER, ADMIN; Idempotency-Key)

Works on an order in `ORDER_CREATED` or `CONFIRMED`. Body: `{ "reason": "Buyer changed plans" }`
(5–500 chars). `200` with the updated order:

```json
"statusHistory": [
  { "from": null, "to": "ORDER_CREATED", "at": "…", "byRole": "BUYER", "reason": null },
  { "from": "ORDER_CREATED", "to": "CANCELLED", "at": "…", "byRole": "BUYER", "reason": "Buyer changed plans" }
]
```

Cancelling again:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "An order in status CANCELLED cannot become CANCELLED",
    "requestId": "0ceabd6a-…",
    "details": { "from": "CANCELLED", "to": "CANCELLED", "allowed": [] }
  }
}
```

### `POST /api/orders/:id/reject` (ADMIN; Idempotency-Key)

Body: `{ "reason": "Deadline cannot be met" }`. Same responses as cancel; ends in `REJECTED`.
Only from `ORDER_CREATED` (a confirmed order can be cancelled, not rejected).

### Feasibility

An explainable check, never a black box: each check says what it compared and why it passed.

| Check | Rule | Result |
|---|---|---|
| `MATERIAL` | **free** yarn of the order's material and colour ≥ `requiredYarnKg`, where free = (total − reserved across all lots) − yarn needed by **other `CONFIRMED` orders** (confirmed orders hold no reservation until Phase 4, so they are subtracted to stop the same kilograms being promised twice) | `PASS` / `FAIL` |
| `DEADLINE` | `requiredBy` is still after today (India calendar) | `PASS` / `FAIL` |
| `MACHINE_CAPACITY` | Not evaluated until machines exist (Phase 7); never fails an order | `NOT_ASSESSED` |

`status` is `NOT_FEASIBLE` if any check is `FAIL`, otherwise `FEASIBLE`. There is no hidden safety margin:
exactly enough yarn passes.

### `GET /api/orders/:id/feasibility` (STORE_KEEPER, FLOOR_MANAGER, ADMIN)

Runs the check now against current stock and changes nothing. Not available to buyers (it reveals stock).

```json
{
  "success": true,
  "data": {
    "feasibility": {
      "status": "NOT_FEASIBLE",
      "checks": [
        { "code": "MATERIAL", "result": "FAIL",
          "message": "Short by 250 kg: needs 850 kg of COTTON Navy yarn but only 600 kg is free (1,450 kg available in stock − 850 kg promised to other confirmed orders)." },
        { "code": "DEADLINE", "result": "PASS", "message": "30 days left until the required-by date (2026-11-09)." },
        { "code": "MACHINE_CAPACITY", "result": "NOT_ASSESSED",
          "message": "Machine capacity and workload are not checked yet: machines arrive in a later phase." }
      ],
      "inputs": {
        "requiredYarnKg": 850, "stockTotalKg": 1650, "stockReservedKg": 200, "stockAvailableKg": 1450,
        "committedKg": 850, "freeKg": 600, "shortfallKg": 250,
        "requiredBy": "2026-11-09", "assessedOn": "2026-10-10", "daysToDeadline": 30
      },
      "computedAt": "2026-10-10T11:02:13.481Z"
    }
  }
}
```

`404` for an unknown order.

### `POST /api/orders/:id/confirm` (ADMIN; Idempotency-Key)

Body: none, or `{}` (any field is a 400: there is no way to force a verdict). The check is run again
**inside the transaction**; if it passes the order becomes `CONFIRMED`, the result is stored on the order
as `feasibility` (the snapshot it was confirmed on, same shape as above), `confirmedBy` is set, and an
`ORDER_CONFIRMED` audit entry is written. `200` with the updated order.

| Status | Code | When |
|---|---|---|
| 409 | `ORDER_NOT_FEASIBLE` | A check failed. `message` lists the reasons; `details.feasibility` has the full result. Nothing is stored, so retrying with the same key after stock arrives runs the check again |
| 409 | `INVALID_STATE_TRANSITION` | The order is not in `ORDER_CREATED` |
| 404 | `NOT_FOUND` | Unknown order |

Two confirmations competing for the same yarn at the same moment cannot both succeed: they serialise on
a lock per material and colour, and the second one sees the first as committed.

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
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same `Idempotency-Key`, different request | Generate a new key for the new action |
| `INSUFFICIENT_STOCK` | 409 | Not enough stock for the change (`details` has the numbers) | Show `details`, refresh stock |
| `CANNOT_DEACTIVATE_SELF` | 409 | Admin targeted own account | Show `message` |
| `LAST_ACTIVE_ADMIN` | 409 | Would leave no active admin | Show `message` |
| `INVALID_STATE_TRANSITION` | 409 | Status change not allowed from the current status; `details`: `{ from, to, allowed }` | Refresh the record; show `message` |
| `BUYER_INACTIVE` | 409 | The buyer company is inactive | Show `message` |
| `PRODUCT_INACTIVE` | 409 | The product is no longer sold | Refresh the catalog |
| `ORDER_NOT_FEASIBLE` | 409 | Confirmation refused: the feasibility check failed; `details.feasibility` | Show the failing checks, refresh the feasibility |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds `JSON_BODY_LIMIT` | Reduce payload |
| `TOO_MANY_REQUESTS` | 429 | Login rate limit | Wait `details.retryAfterSeconds` |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Generic error + `requestId` |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable | Retry later (offline queue may retry) |

Domain codes are added with their phase, e.g. `ALREADY_DISPATCHED` (409). Codes not in the table
above are **not available yet**.

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
  models/           Mongoose models (User, Buyer, Product, Order, Counter, YarnLot,
                    InventoryTransaction, AuditLog, IdempotencyRecord)
  models/plugins/   appendOnly (ledger and audit log can't be updated or deleted)
  repositories/     data access with guarded atomic updates (yarn lots, ledger)
  audit/            recordAudit(): audit entry inside the business transaction
  validators/       zod request schemas
  services/         business rules: auth, users, inventory, catalog, orders, feasibility,
                    idempotency, password hashing, tokens
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
- Every stock/production/sync mutation: route has `requireIdempotencyKey`; service wraps its work in
  `executeIdempotent()` and writes business change + ledger + `recordAudit()` with the same `session`.
- Store quantities as integers (grams, centimetres) and money as integer paise; convert at the edge.
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
