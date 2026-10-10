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
  feasibility: (id) => apiRequest(`/orders/${id}/feasibility`),
  create: (body, idempotencyKey) =>
    apiRequest("/orders", { method: "POST", body, idempotencyKey }),
  update: (id, body, idempotencyKey) =>
    apiRequest(`/orders/${id}`, { method: "PATCH", body, idempotencyKey }),
  // Phase 4: material reservation (store keeper / admin; reservations visible to planning roles).
  reserve: (id, body, idempotencyKey) =>
    apiRequest(`/orders/${id}/reserve`, { method: "POST", body, idempotencyKey }),
  reservations: (id) => apiRequest(`/orders/${id}/reservations`),
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
