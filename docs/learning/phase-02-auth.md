# Learning digest — Phase 2: Authentication & RBAC

## The business rules in one breath

Nobody signs themselves up; an admin grants every account. A request proves who it is with a
token; the server then checks the person's **current** role and status in the database before
letting them act. Failures say as little as possible: "who are you?" is a 401, "you may not" is a
403, and a failed login never reveals whether the email exists.

## Data flow in plain English

**Logging in** (`POST /api/auth/login`)
1. The IP rate limiter counts the attempt (max 100 per IP per 15 min).
2. zod checks the body: email is a string (trimmed, lowercased), password is a string ≤ 72 bytes.
3. The per-account limiter checks failed attempts for this IP + email (max 5).
4. The auth service looks up the user *with* the password hash (normally hidden).
   - Not found → compare against a dummy hash anyway (same time), then 401.
   - Found → bcrypt compare; if wrong **or** the account is deactivated → 401.
5. On success: record `lastLoginAt`, sign a JWT `{ sub: userId, tv: tokenVersion }` for 8h,
   return the token plus the public user. `Cache-Control: no-store`.

**Calling a protected endpoint** (e.g. `POST /api/users`)
1. `authenticate` reads `Authorization: Bearer …`, verifies signature (HS256 only), issuer,
   audience and expiry.
2. It loads the user by id and rejects them if missing, deactivated, or if the token's `tv` is older
   than the user's `tokenVersion`. It sets a frozen `req.user = { id, role, name, email }` and tags
   logs with `userId`.
3. `authorize(ROLES.ADMIN)` compares `req.user.role` (from the DB) with the allowed list → 403 if not.
4. `validate` parses the body with zod; strict schemas reject unknown fields.
5. Controller calls the service; the service applies business rules and returns a public shape.

**Deactivating someone** (`PATCH /api/users/:id/status`)
In one transaction: load the target; if it is an admin, write a shared lock document and count the
other active admins; refuse if none; otherwise set `isActive: false` and `tokenVersion + 1`. Their
existing tokens now fail step 2 above on the very next request.

## Key design decisions and why

| Decision | Why | Trade-off we accept |
|---|---|---|
| Re-read the user on every request | Deactivation and role changes apply instantly; the token never has to be trusted for role | One indexed `_id` lookup per request (~ms) |
| Token holds only `sub` + `tv` | JWTs are readable by anyone (Base64); the DB is the authority | Frontend must get the role from `/me` or the login response |
| `tokenVersion` instead of a token blacklist | One integer revokes every token for a user; no extra collection | Can't revoke a single device's token (all or nothing) |
| 8h tokens, no refresh tokens | A shift-length session is simple and defensible | A stolen token works until expiry unless the user is deactivated/revoked |
| bcryptjs (pure JS), cost 12 | No native build on Windows/Docker; ~250ms per hash slows guessing | ~30% slower than native; CPU work on the event loop per login |
| Dummy-hash on unknown email | Equal work → no timing oracle for which emails exist | Unknown emails cost a bcrypt compare too |
| Rate limit by IP **+ email** | Factory tablets share one public IP; per-IP-only would lock the whole floor out | An attacker can rotate emails (caught by the 100/IP backstop) |
| Secure-by-default router | A new route is protected even if the developer forgets | Unknown `/api` paths answer 401 (not 404) to anonymous callers |
| `authorize` before `validate` | A non-admin can't learn the admin form's rules from 400 details | — |
| Strict zod body for create/status | Mass assignment is rejected loudly, not silently dropped | Clients must send exactly the documented fields |
| Shared lock doc for admin deactivation | Snapshot isolation allows write skew (two admins deactivate each other); writing one shared doc forces a conflict and a retry | One tiny `locks` collection |
| No repository layer yet | A repository over `User.findOne` would add a file without meaning | Added from Phase 3 (inventory) where queries/transactions justify it |

## Things that surprised us (good to mention to a judge)

- **The last-admin guard is unreachable sequentially.** The caller must be an active admin and
  can't target themselves, so another admin always remains. It exists for the race, and the test
  proves the race is real: remove the lock and the concurrent test fails 5 out of 5 runs.
- **bcrypt reads only 72 bytes.** `"₹" × 25` is 25 characters but 75 bytes; without a byte check
  the last character would be ignored silently.
- **`z.coerce.boolean()` turns `"false"` into `true`.** We use `z.stringbool()` for query flags.

## Judge-style questions (try first, then read the model answer)

**1. "Your token says the user is an ADMIN. Why do you hit the database on every request anyway?"**
> The token deliberately does **not** say the role — it only carries the user id and a token
> version. If the role were in the token, demoting or deactivating someone would have no effect
> until the token expired (up to 8 hours). By re-reading the user, a deactivation, demotion or
> revocation applies on the very next request. The cost is one indexed `_id` lookup, a few
> milliseconds, which is acceptable for a factory system; a judge should hear us name that cost.

**2. "An attacker has a list of 1,000 emails. How do they find out which ones have accounts?"**
> Through the response: they can't — unknown email, wrong password and deactivated account give the
> same status, code and message. Through timing: they can't either — for an unknown email we still
> run bcrypt against a dummy hash, so every failed login does exactly one bcrypt comparison (a test
> spies on `bcrypt.compare` to prove it; a stopwatch test would be flaky). Through volume: 100
> attempts per IP per 15 minutes. Residual: the DB lookup itself differs slightly; it is noise next
> to ~250ms of bcrypt, and we say so rather than claim perfection.

**3. "Why 401 for a deactivated user's token? They're authenticated — shouldn't it be 403?"**
> Authentication is "do we accept this identity *now*?", not "was this token ever valid?". Once an
> admin deactivates the account we no longer accept that identity, so it's 401, and the frontend
> drops the token and shows login. A 403 would tell the UI "you're logged in but lack permission",
> keeping a dead session alive. We also return the same 401 as for a forged token so the response
> doesn't reveal the account's status.

**4. "Two admins click 'deactivate' on each other at the same moment. Walk me through it."**
> Each request runs in a MongoDB transaction: read the target, count the *other* active admins,
> deactivate. Under snapshot isolation both transactions see "one other admin remains" and both
> would commit, because they write different documents — that's write skew. We make both
> transactions also write one shared lock document, so MongoDB detects a write conflict and aborts
> one; `withTransaction` retries it, the retry sees the other's commit, finds zero other admins and
> returns `409 LAST_ACTIVE_ADMIN`. Exactly one admin remains. The test runs both requests
> concurrently, and fails when the lock line is removed.

**5. "A Buyer can call `GET /api/orders/:id`. How do you stop Buyer A reading Buyer B's order?"**
> Not with RBAC — both are `BUYER`, so `authorize('BUYER')` lets both through. That needs an
> **ownership** (object-level) check in the order service: load the order, and if the caller is a
> Buyer, require `order.buyerId` to match the caller's buyer account, else respond as if it doesn't
> exist (404, so IDs can't be probed). That is OWASP API #1 (Broken Object Level Authorization) and
> it lands with orders in Phase 5. Phase 2 provides the identity (`req.user`) it builds on.
