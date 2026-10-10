import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';

// A client-supplied id is untrusted input that ends up in our logs.
// Accept only a short, plain token; anything else gets a fresh UUID.
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
export const REQUEST_ID_HEADER = 'X-Request-Id';

export function resolveRequestId(incoming) {
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

export function requestLogger(logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const id = resolveRequestId(req.headers['x-request-id']);
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}
