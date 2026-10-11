import { apiRequest } from "./client.js";

// One function per backend endpoint (contract: backend/README.md). Pages import from here.

export const authApi = {
  login: (email, password) =>
    apiRequest("/auth/login", { method: "POST", body: { email, password } }),
  me: () => apiRequest("/auth/me"),
};

export const usersApi = {
  list: (query) => apiRequest("/users", { query }),
  create: (body) => apiRequest("/users", { method: "POST", body }),
  setStatus: (id, isActive) =>
    apiRequest(`/users/${id}/status`, { method: "PATCH", body: { isActive } }),
};

export const buyersApi = {
  list: (query) => apiRequest("/buyers", { query }),
  get: (id) => apiRequest(`/buyers/${id}`),
  create: (body) => apiRequest("/buyers", { method: "POST", body }),
  update: (id, body) =>
    apiRequest(`/buyers/${id}`, { method: "PATCH", body }),
  setStatus: (id, isActive) =>
    apiRequest(`/buyers/${id}/status`, { method: "PATCH", body: { isActive } }),
};

export const productsApi = {
  list: (query) => apiRequest("/products", { query }),
  get: (id) => apiRequest(`/products/${id}`),
  create: (body) => apiRequest("/products", { method: "POST", body }),
  update: (id, body) =>
    apiRequest(`/products/${id}`, { method: "PATCH", body }),
  setStatus: (id, isActive) =>
    apiRequest(`/products/${id}/status`, { method: "PATCH", body: { isActive } }),
};

export const ordersApi = {
  list: (query) => apiRequest("/orders", { query }),
  get: (id) => apiRequest(`/orders/${id}`),
  // Buyer-facing order timeline (GET /api/orders/:id/timeline; owning buyer or staff).
  timeline: (id) => apiRequest(`/orders/${id}/timeline`),
  feasibility: (id) => apiRequest(`/orders/${id}/feasibility`),
  create: (body, idempotencyKey) =>
    apiRequest("/orders", { method: "POST", body, idempotencyKey }),
  update: (id, body, idempotencyKey) =>
    apiRequest(`/orders/${id}`, { method: "PATCH", body, idempotencyKey }),
  // Phase 4: material reservation (store keeper / admin; reservations visible to planning roles).
  reserve: (id, body, idempotencyKey) =>
    apiRequest(`/orders/${id}/reserve`, { method: "POST", body, idempotencyKey }),
  reservations: (id) => apiRequest(`/orders/${id}/reservations`),
  // More yarn for a continuation run or remakes (floor manager / admin; reason required).
  reserveAdditional: (id, body, idempotencyKey) =>
    apiRequest(`/orders/${id}/reserve-additional`, { method: "POST", body, idempotencyKey }),
  issue: (id, quantityKg, idempotencyKey) =>
    apiRequest(`/orders/${id}/issue`, { method: "POST", body: { quantityKg }, idempotencyKey }),
  returnYarn: (id, body, idempotencyKey) =>
    apiRequest(`/orders/${id}/return`, { method: "POST", body, idempotencyKey }),
  confirm: (id, idempotencyKey) =>
    apiRequest(`/orders/${id}/confirm`, {
      method: "POST",
      body: {},
      idempotencyKey,
    }),
  cancel: (id, reason, idempotencyKey) =>
    apiRequest(`/orders/${id}/cancel`, {
      method: "POST",
      body: { reason },
      idempotencyKey,
    }),
  reject: (id, reason, idempotencyKey) =>
    apiRequest(`/orders/${id}/reject`, {
      method: "POST",
      body: { reason },
      idempotencyKey,
    }),
};

export const inventoryApi = {
  lots: (query) => apiRequest("/yarn-lots", { query }),
  lot: (id) => apiRequest(`/yarn-lots/${id}`),
  lotTransactions: (id, query) =>
    apiRequest(`/yarn-lots/${id}/transactions`, { query }),
  receive: (body, idempotencyKey) =>
    apiRequest("/yarn-lots", { method: "POST", body, idempotencyKey }),
  adjust: (id, body, idempotencyKey) =>
    apiRequest(`/yarn-lots/${id}/adjustments`, {
      method: "POST",
      body,
      idempotencyKey,
    }),
  summary: (query) => apiRequest("/inventory/yarn-summary", { query }),
  reconciliation: () => apiRequest("/inventory/reconciliation"),
};

// Phase 7: machines. Status actions carry an Idempotency-Key (one per user action).
export const machinesApi = {
  list: (query) => apiRequest("/machines", { query }),
  get: (id) => apiRequest(`/machines/${id}`),
  events: (id, query) => apiRequest(`/machines/${id}/events`, { query }),
  create: (body) => apiRequest("/machines", { method: "POST", body }),
  update: (id, body) => apiRequest(`/machines/${id}`, { method: "PATCH", body }),
  setActive: (id, isActive) =>
    apiRequest(`/machines/${id}/active`, { method: "PATCH", body: { isActive } }),
  startMaintenance: (id, body, idempotencyKey) =>
    apiRequest(`/machines/${id}/maintenance/start`, { method: "POST", body, idempotencyKey }),
  endMaintenance: (id, body, idempotencyKey) =>
    apiRequest(`/machines/${id}/maintenance/end`, { method: "POST", body, idempotencyKey }),
  reportProblem: (id, body, idempotencyKey) =>
    apiRequest(`/machines/${id}/problems`, { method: "POST", body, idempotencyKey }),
  resolveProblem: (id, eventId, resolution, idempotencyKey) =>
    apiRequest(`/machines/${id}/problems/${eventId}/resolve`, {
      method: "POST",
      body: { resolution },
      idempotencyKey,
    }),
  // Admin: correct a finished maintenance's cost (reason required; a new record).
  correctMaintenanceCost: (id, eventId, body, idempotencyKey) =>
    apiRequest(`/machines/${id}/maintenance/${eventId}/cost-correction`, { method: "POST", body, idempotencyKey }),
};

// Phase 8: production runs. Every action carries an Idempotency-Key (one per user action).
export const productionApi = {
  list: (query) => apiRequest("/production-runs", { query }),
  get: (id) => apiRequest(`/production-runs/${id}`),
  plan: (body, idempotencyKey) =>
    apiRequest("/production-runs", { method: "POST", body, idempotencyKey }),
  act: (id, action, body, idempotencyKey) =>
    apiRequest(`/production-runs/${id}/${action}`, { method: "POST", body: body ?? {}, idempotencyKey }),
  recordRoll: (id, body, idempotencyKey) =>
    apiRequest(`/production-runs/${id}/rolls`, { method: "POST", body, idempotencyKey }),
};

// Phases 9-10: rolls (traceability) and QC.
export const rollsApi = {
  list: (query) => apiRequest("/rolls", { query }),
  trace: (id) => apiRequest(`/rolls/${id}`),
  inspect: (id, body, idempotencyKey) =>
    apiRequest(`/rolls/${id}/inspections`, { method: "POST", body, idempotencyKey }),
  reworkDone: (id, note, idempotencyKey) =>
    apiRequest(`/rolls/${id}/rework-done`, { method: "POST", body: note ? { note } : {}, idempotencyKey }),
};

export const qcApi = {
  inspections: (query) => apiRequest("/qc/inspections", { query }),
  summary: () => apiRequest("/qc/summary"),
};

// Phases 11-12: finished goods, dispatch and invoices.
export const fulfilmentApi = {
  finishedGoods: (query) => apiRequest("/finished-goods", { query }),
  // What can be dispatched per order, and why not (one rule for the Ready list and Prepare dispatch).
  availability: (orderId) => apiRequest("/finished-goods/availability", { query: orderId ? { orderId } : {} }),
  moveGood: (id, location, idempotencyKey) =>
    apiRequest(`/finished-goods/${id}/location`, { method: "PATCH", body: { location }, idempotencyKey }),
  dispatches: (query) => apiRequest("/dispatches", { query }),
  dispatch: (id) => apiRequest(`/dispatches/${id}`),
  prepare: (body, idempotencyKey) => apiRequest("/dispatches", { method: "POST", body, idempotencyKey }),
  confirm: (id, body, idempotencyKey) => apiRequest(`/dispatches/${id}/confirm`, { method: "POST", body, idempotencyKey }),
  cancel: (id, reason, idempotencyKey) => apiRequest(`/dispatches/${id}/cancel`, { method: "POST", body: { reason }, idempotencyKey }),
  invoice: (id, idempotencyKey) => apiRequest(`/dispatches/${id}/invoice`, { method: "POST", body: {}, idempotencyKey }),
  // Delivery after dispatch: buyer (or admin for them) confirms / reports a problem; admin verifies.
  delivery: (id, action, body, idempotencyKey) =>
    apiRequest(`/dispatches/${id}/delivery/${action}`, { method: "POST", body, idempotencyKey }),
  invoices: (query) => apiRequest("/invoices", { query }),
  getInvoice: (id) => apiRequest(`/invoices/${id}`),
  // Buyer payments (admin records and reverses; the owning buyer reads).
  invoicePayments: (id) => apiRequest(`/invoices/${id}/payments`),
  recordPayment: (id, body, idempotencyKey) => apiRequest(`/invoices/${id}/payments`, { method: "POST", body, idempotencyKey }),
  reversePayment: (id, reason, idempotencyKey) => apiRequest(`/payments/${id}/reverse`, { method: "POST", body: { reason }, idempotencyKey }),
  receivables: () => apiRequest("/payments/receivables"),
  summary: () => apiRequest("/summary/fulfilment"),
};

// The owner's month-end statement (admin).
export const financeApi = {
  monthly: (month) => apiRequest("/finance/monthly", { query: { month } }),
  trend: (months = 6) => apiRequest("/finance/trend", { query: { months } }),
};

// Workers, attendance register and wages (wages and rates: admin only; the server decides).
export const workforceApi = {
  workers: (query) => apiRequest("/workers", { query }),
  worker: (id) => apiRequest(`/workers/${id}`),
  createWorker: (body) => apiRequest("/workers", { method: "POST", body }),
  updateWorker: (id, body) => apiRequest(`/workers/${id}`, { method: "PATCH", body }),
  attendance: (query) => apiRequest("/attendance", { query }),
  register: (query) => apiRequest("/attendance/register", { query }),
  record: (body, idempotencyKey) => apiRequest("/attendance", { method: "POST", body, idempotencyKey }),
  correct: (id, body) => apiRequest(`/attendance/${id}`, { method: "PATCH", body }),
  wageSummary: (query) => apiRequest("/wages/summary", { query }),
};

// Phase 13: audit center.
export const auditApi = {
  list: (query) => apiRequest("/audit", { query }),
  actions: () => apiRequest("/audit/actions"),
  correct: (id, note) => apiRequest(`/audit/${id}/corrections`, { method: "POST", body: { note } }),
};

// Phase 14: costing (owner only).
export const costingApi = {
  summary: () => apiRequest("/costing/summary"),
  overview: () => apiRequest("/costing/overview"),
  order: (id) => apiRequest(`/costing/orders/${id}`),
  rates: () => apiRequest("/costing/rates"),
  saveRates: (body) => apiRequest("/costing/rates", { method: "POST", body }),
};

// Phase 17: delivery risk and recommendations (admin, floor, store).
export const intelligenceApi = {
  overview: () => apiRequest("/intelligence/overview"),
  order: (id) => apiRequest(`/intelligence/orders/${id}`),
};

// Cryptographic signatures: independent verification and public key information.
export const signaturesApi = {
  verify: (id) => apiRequest(`/signatures/${id}/verify`),
  myKey: () => apiRequest("/signatures/keys/me"),
};

// What needs the signed-in user's attention (badges, dashboard insights).
export const attentionApi = {
  get: () => apiRequest("/summary/attention"),
};

// Editing a yarn lot's descriptive details (store keeper, admin).
export const yarnLotsApi = {
  update: (id, body) => apiRequest(`/yarn-lots/${id}`, { method: "PATCH", body }),
};
