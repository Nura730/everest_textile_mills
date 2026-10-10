// The one place that talks HTTP to the backend. Pages call the functions in endpoints.js; nothing
// else should call fetch() directly.
//
// Backend contract (backend/README.md): every response is
//   { success: true, data, meta? }  or  { success: false, error: { code, message, details?, requestId } }

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId ?? null;
  }

  get isNetworkError() {
    return this.code === 'NETWORK_ERROR';
  }
}

let getToken = () => null;
let onUnauthorized = () => {};

/** Wired by AuthProvider: where the token lives, and what to do when the server rejects it. */
export function configureApi({ tokenGetter, unauthorizedHandler }) {
  getToken = tokenGetter;
  onUnauthorized = unauthorizedHandler;
}

function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${BASE_URL}${path}${search ? `?${search}` : ''}`;
}

/**
 * Returns { data, meta, replayed }. Throws ApiError for every failure, including network errors,
 * so callers have one error type to handle.
 */
export async function apiRequest(path, { method = 'GET', body, query, idempotencyKey, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Check that the backend is running and your connection is up.',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response (e.g. proxy error page): handled below as a generic failure.
  }

  if (!response.ok || !payload?.success) {
    const error = payload?.error ?? {};
    const apiError = new ApiError({
      status: response.status,
      code: error.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${response.status}`),
      message:
        error.message ??
        (response.status === 502 || response.status === 504
          ? 'The backend is not responding. Is it running on port 4000?'
          : `Request failed (${response.status})`),
      details: error.details,
      requestId: error.requestId ?? response.headers.get('X-Request-Id'),
    });
    // A rejected token anywhere (other than a failed login) ends the session.
    if (response.status === 401 && path !== '/auth/login') onUnauthorized(apiError);
    throw apiError;
  }

  return {
    data: payload.data,
    meta: payload.meta,
    replayed: response.headers.get('Idempotent-Replayed') === 'true',
  };
}

/** VALIDATION_ERROR details → { fieldName: message } for showing errors beside inputs. */
export function fieldErrorsOf(error) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const fields = {};
  for (const detail of error.details) {
    const key = detail.path || (detail.location === 'headers' ? 'form' : 'form');
    if (!fields[key]) fields[key] = detail.message;
  }
  return fields;
}

/** A new key per user action; reuse the same key when retrying that action. */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}
