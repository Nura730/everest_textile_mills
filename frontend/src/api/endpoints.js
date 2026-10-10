import { apiRequest } from './client.js';

// One function per backend endpoint (contract: backend/README.md). Pages import from here.

export const authApi = {
  login: (email, password) => apiRequest('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => apiRequest('/auth/me'),
};

export const usersApi = {
  list: (query) => apiRequest('/users', { query }),
  create: (body) => apiRequest('/users', { method: 'POST', body }),
  setStatus: (id, isActive) => apiRequest(`/users/${id}/status`, { method: 'PATCH', body: { isActive } }),
};

export const buyersApi = {
  list: (query) => apiRequest('/buyers', { query }),
  get: (id) => apiRequest(`/buyers/${id}`),
  create: (body) => apiRequest('/buyers', { method: 'POST', body }),
};

export const productsApi = {
  list: (query) => apiRequest('/products', { query }),
  get: (id) => apiRequest(`/products/${id}`),
  create: (body) => apiRequest('/products', { method: 'POST', body }),
};

export const ordersApi = {
  list: (query) => apiRequest('/orders', { query }),
  get: (id) => apiRequest(`/orders/${id}`),
  create: (body, idempotencyKey) => apiRequest('/orders', { method: 'POST', body, idempotencyKey }),
  cancel: (id, reason, idempotencyKey) =>
    apiRequest(`/orders/${id}/cancel`, { method: 'POST', body: { reason }, idempotencyKey }),
  reject: (id, reason, idempotencyKey) =>
    apiRequest(`/orders/${id}/reject`, { method: 'POST', body: { reason }, idempotencyKey }),
};

export const inventoryApi = {
  lots: (query) => apiRequest('/yarn-lots', { query }),
  lot: (id) => apiRequest(`/yarn-lots/${id}`),
  lotTransactions: (id, query) => apiRequest(`/yarn-lots/${id}/transactions`, { query }),
  receive: (body, idempotencyKey) => apiRequest('/yarn-lots', { method: 'POST', body, idempotencyKey }),
  adjust: (id, body, idempotencyKey) =>
    apiRequest(`/yarn-lots/${id}/adjustments`, { method: 'POST', body, idempotencyKey }),
  summary: (query) => apiRequest('/inventory/yarn-summary', { query }),
  reconciliation: () => apiRequest('/inventory/reconciliation'),
};
