# Backend progress

Last updated: 2026-10-10

## Phase status

| # | Phase | Status | Branch | PR | Tests |
|---|---|---|---|---|---|
| 1 | Foundation | ✅ Done | `feature/backend` | #3 (merged to `main`) | 75 |
| 2 | Auth & RBAC | 🔍 In review | `feature/backend-auth` | see below | 270 |
| — | Domain model (`docs/DATABASE.md`) | ⏳ Next | | | |
| 3 | Yarn inventory | Not started | | | |
| 4 | Material reservation | Not started | | | |
| 5 | Orders (+ ownership checks) | Not started | | | |
| 6 | Feasibility | Not started | | | |
| 7 | Machines | Not started | | | |
| 8 | Production runs | Not started | | | |
| 9 | Roll traceability | Not started | | | |
| 10 | QC | Not started | | | |
| 11 | Finished goods | Not started | | | |
| 12 | Dispatch | Not started | | | |
| 13 | Audit trail | Not started | | | |
| 14 | Costing | Not started | | | |
| 15 | Offline sync | Not started | | | |
| 16 | Realtime | Not started | | | |
| 17 | Intelligence | Not started | | | |

## Phase 2 — what is done

- User model, roles, bcrypt hashing (72-byte guard), HS256 JWT (8h, `sub` + `tv` only).
- `POST /api/auth/login` (timing-safe, rate-limited), `GET /api/auth/me`.
- `authenticate` (DB re-read per request) and `authorize(...roles)`; secure-by-default router.
- Admin user management: create, list, activate/deactivate with self and last-admin guards.
- `npm run seed:dev`, `npm run bootstrap:admin`.
- RBAC matrix test and a whole-API credential-leak sweep.
- Docs: `backend/README.md` auth contract, `docs/features/phase-02-auth.md`, `docs/learning/phase-02-auth.md`.

## Next

1. `docs/DATABASE.md` — full domain model (own commit).
2. Phase 3 — yarn inventory on `feature/backend-inventory`.

## Open decisions / process issues

- **`develop` is stale.** Teammates merge PRs into `main` (PRs #4–#15 went to `main`), so `develop`
  is still at Phase 1 (`e20555d`). Backend PRs target `develop` as agreed, but someone with
  permission should fast-forward `develop` to `main` (or the team should agree on one integration
  branch). The backend is unaffected (all `main` changes are under `frontend/`).
- **PRs must be opened by hand**: the GitHub CLI (`gh`) is not installed on this machine, so the
  branch is pushed and the PR link/description is provided instead.
- `instruction.md` has an uncommitted local edit (references to `@docs/PROGRESS.md`); it is not
  part of any backend commit.

## Known issues / limitations

- Login rate limits are in memory (per process, reset on restart).
- `trust proxy` must be configured if deployed behind a reverse proxy.
- Audit events for login and user management are specified but not emitted until Phase 13.
- SIGTERM graceful-shutdown test is skipped on Windows.
- Dev-only `npm audit` advisories in `sprintf-js` (via Jest); runtime dependencies have none.
