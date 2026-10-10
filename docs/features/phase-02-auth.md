# Phase 2 — Authentication & RBAC

> Written at the end of the phase (the per-phase spec process started mid-phase). The design was
> agreed in conversation before implementation; this file records it. From Phase 3 on, the spec is
> written before any code.

## Users

All five roles (`STORE_KEEPER`, `FLOOR_MANAGER`, `QC_INSPECTOR`, `BUYER`, `ADMIN`). ADMIN manages accounts.

## Problem

Every later feature (stock, production, QC, dispatch, cost) must know **who** is calling and
whether their **role** may do it. The factory has a closed set of people, so accounts carry
authority and must be granted by someone accountable.

## Business rules

1. **No public registration.** Only an ADMIN creates accounts, of any role, including other ADMINs.
   The creator is recorded (`createdBy`). The very first ADMIN comes from a bootstrap script run by
   someone with server access.
2. **401 vs 403.** 401 = identity unknown or no longer accepted (no/invalid/expired token,
   deactivated or revoked account). 403 = identity valid, role not permitted.
3. **The database is the authority**, not the token. The user is re-read on every request; the
   role, active flag and token version come from MongoDB. A demotion or deactivation applies on the
   next request.
4. **Login reveals nothing.** Unknown email, wrong password and deactivated account return the same
   `401 INVALID_CREDENTIALS` and do the same bcrypt work.
5. **Deactivate, never delete.** Deactivation revokes all tokens (`tokenVersion++`). An admin cannot
   deactivate themselves; the last active admin cannot be deactivated.
6. **Role checks happen on the server for every protected route.** Hiding UI is cosmetic.
7. **Ownership** (a Buyer sees only *their* orders) is a separate, object-level check that arrives
   with orders in Phase 5. Roles alone cannot provide it.

## Data

`User`: `name`, `email` (lowercased, unique), `passwordHash` (`select: false`), `role` (enum),
`isActive`, `tokenVersion`, `lastLoginAt`, `createdBy`, timestamps.
`locks` collection: one document (`user-admin-status`) used to serialise admin deactivations.

## API

| Method | Path | Roles |
|---|---|---|
| POST | `/api/auth/login` | public (rate-limited) |
| GET | `/api/auth/me` | any |
| GET | `/api/users` | ADMIN |
| POST | `/api/users` | ADMIN |
| PATCH | `/api/users/:id/status` | ADMIN |

Full contract: `backend/README.md`.

## Edge cases

- Missing/garbage/`Basic` header, `alg: none`, HS512, wrong issuer/audience, malformed `sub` → 401.
- Expired but genuine token → `401 TOKEN_EXPIRED`; expired *and* forged → `401 UNAUTHENTICATED`.
- Password > 72 bytes (bcrypt would silently truncate) → 400; counted in bytes (`₹` = 3).
- Email case and whitespace → normalised before lookup and storage.
- `{ "email": { "$ne": null } }` → 400 (zod requires a string), not "log in as anyone".
- Mass assignment (`isActive`, `tokenVersion`, `passwordHash` in a create body) → 400.
- Two identical create requests at once → one 201, one 409 (unique index).
- Two admins deactivating each other at once → exactly one succeeds.
- Brute force: 5 failed attempts per (IP, email) and 100 attempts per IP per 15 minutes → 429.

## Audit events (to be emitted when the audit trail lands in Phase 13)

`USER_LOGIN_SUCCEEDED`, `USER_LOGIN_FAILED`, `USER_CREATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`.

## Tests

`tests/unit/{env,password.service,token.service}.test.js`,
`tests/integration/{user.model,auth.middleware,auth.routes,auth.rateLimit,users.create,users.status,rbac.matrix,scripts}.test.js`.
