# Phase 17 — Rules-based intelligence

## Business rules
1. Every open order (confirmed to ready for dispatch) gets a delivery outlook: LATE, AT_RISK or ON_TRACK,
   with an expected finish date, the factors behind it and what to do.
2. The estimate uses only recorded facts: produced and rejected metres, the rated speed of the machines on
   the order, machine status, yarn shortfall, QC results, and the working hours per day from the rate card.
3. Recommendations are concrete actions with their effect (e.g. split onto a free loom: 9 days instead
   of 17). Machines with 3+ problems in 30 days are flagged for preventive maintenance.
4. Planners (owner, floor, store) see the detail; buyers see only a plain outlook on their timeline.
5. Assumptions are listed on the page; nothing is hidden in a model.

## UI
Insights page (orders ranked by risk with reasons and actions; machines needing attention). Order detail
shows the delivery outlook to planners; the buyer timeline shows the outlook in plain words.

## Tests
`tests/integration/intelligence.test.js` (pure rule cases with hand-checked numbers; endpoints; buyer
outlook), RBAC matrix rows; E2E on a throwaway DB.
