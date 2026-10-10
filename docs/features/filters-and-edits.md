# Filters and edit actions on existing screens

> Extends existing features only: no new module or page. Decisions confirmed by the owner:
> orders editable only while `ORDER_CREATED`; products edit name, price and yarn g/m; a stale edit is
> refused (409) rather than overwriting someone else's change.

## Filters (all server-side, combinable, page resets on change, "Clear filters" on every list)

| Screen | Filters | Notes |
|---|---|---|
| Orders | Search (order no., buyer, fabric), status, fabric, buyer (ADMIN), required-by from/to, overdue | Overdue = deadline before today (IST) and delivery pending (not cancelled, rejected, dispatched or invoiced). Buyers stay scoped to their company whatever they send |
| Yarn inventory | Material, colour (lots tab), include empty lots | Colour choices = colours in stock for the material |
| Lot ledger | Movement type, from/to (Indian calendar days) | Related order arrives with reservation (Phase 4) |
| Fabric catalog | Search (code, name), material, colour, weave, status (ADMIN) | Non-admins only ever get active fabrics |
| Users | Search (name, email), role, status | |
| Buyers | Search (code, name), status | |

Not filtered: preview screens (sample data), dashboards, low stock (no defined threshold).

## Edit actions

| Record | Who | Editable | Locked |
|---|---|---|---|
| Buyer company | ADMIN | Name, contact, email, phone, address; activate/deactivate | Code; users and orders keep their link; orders keep their name snapshot |
| Product | ADMIN | Name, price/m, yarn g/m (≥ fabric weight); retire/reactivate | Code, material, colour, weave, width, GSM, machine type; orders keep their snapshot |
| Order | Owning BUYER, ADMIN | Quantity, required-by, notes, only while `ORDER_CREATED` | Product, buyer, price, totals, yarn (recalculated by the server), status, number |
| User | ADMIN | Activate/deactivate (unchanged) | Role, email |
| Yarn lot | — | None: stock changes only through receive and adjust (ledger + audit) | Everything |

Every edit: field allow-list on the server (strict body), `expectedUpdatedAt` stale check (409
`CONFLICT`, `details.reason: STALE_EDIT`), no-op when nothing changes, audit entry with only the changed
fields (`BUYER_UPDATED`, `BUYER_STATUS_CHANGED`, `PRODUCT_UPDATED`, `PRODUCT_STATUS_CHANGED`,
`ORDER_UPDATED`). Order edits also use an Idempotency-Key and refuse with `409 ORDER_NOT_EDITABLE` once
the order is confirmed or closed. An edit racing a confirmation cannot apply against the wrong figures:
both write the same order inside transactions, so one waits for and re-reads the other.

## Tests
`tests/integration/filters.test.js`, `tests/integration/edits.test.js`, `tests/unit/search.test.js`,
RBAC matrix rows for the five new routes.
