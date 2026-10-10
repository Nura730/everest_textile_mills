# Development accounts (local development and demos only)

> These accounts exist only in a development database seeded with `npm run seed:dev`.
> The script **refuses to run when `NODE_ENV=production`**. This file is not part of the frontend
> build or any deployment artifact, and it contains **no passwords**.

## How to create them

```bash
cd backend
# backend/.env must contain MONGODB_URI, JWT_SECRET and SEED_PASSWORD (≥ 10 characters)
npm run seed:dev
```

Every account below uses the password in **`SEED_PASSWORD`** from your local `backend/.env`
(hashed with bcrypt by the seed; the plain value is never stored or printed).
The seed is idempotent: re-running it creates nothing twice and never overwrites a password.

## Accounts

| Email | Role | What they see |
|---|---|---|
| `admin@everest.local` | ADMIN | Everything: overview, orders, buyers, catalog, inventory, users, previews |
| `store@everest.local` | STORE_KEEPER | Stock, receiving yarn, orders (no prices), catalog |
| `floor@everest.local` | FLOOR_MANAGER | Work queue, stock (no cost), orders (no prices), catalog |
| `qc@everest.local` | QC_INSPECTOR | Orders pipeline (no prices), catalog, QC preview |
| `buyer@everest.local` | BUYER — company `BUY-DEV` (Dev Buyer Textiles) | Only BUY-DEV's orders and the catalog |
| `buyer2@everest.local` | BUYER — company `BUY-TPR` (Tiruppur Knits) | Only BUY-TPR's orders — use it to show buyer isolation |

## Demo data the seed creates (through the real services)

- Buyer companies `BUY-DEV`, `BUY-TPR`; products `COT-NAVY-PLAIN` (170 g/m, ₹180/m) and
  `POL-WHITE-TWILL` (235 g/m, ₹150/m).
- Yarn lots `GRN-DEMO-0001…0004` (Navy cotton 1,650 kg, White polyester 900 kg, Red cotton 60 kg).
- Five orders: three open, one cancelled by the buyer, one rejected by the admin — each with its
  ledger, audit and status-history records.

To start completely fresh, point `MONGODB_URI` at an empty database and run the seed again
(the seed never deletes anything).
