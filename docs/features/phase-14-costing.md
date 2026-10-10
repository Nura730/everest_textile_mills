# Phase 14 — Costing and profitability

## Business rules
1. Cost and profit are visible to the owner (ADMIN) only.
2. Material cost is actual: the yarn issued to the order, net of returns, at each lot's purchase cost.
3. Labour and machine cost are running hours × rates (decision D6: no attendance/wage module). Running hours
   come from the run's status history; pauses are excluded.
4. Rework, overhead and waste follow the rate card; waste is shown as the cost inside rejected rolls and is
   already part of the totals.
5. Revenue is invoiced (ex-GST); before invoicing the order value is shown, marked as expected.
6. The rate card is versioned and append-only; an order uses the version in force when its production
   started, so later rate changes never rewrite past costs. Every sheet lists its assumptions.

## UI
Costing page (KPIs, owner overview, profit by order, rate card editor). Admin order detail shows the cost
sheet with the detail behind each figure.

## Tests
`tests/integration/costing.test.js` (hand-checked figures), RBAC matrix rows.
