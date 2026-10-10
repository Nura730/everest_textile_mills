import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { getConfig } from './config/env.js';
import { getLogger } from './config/logger.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { REQUEST_ID_HEADER, requestLogger } from './middleware/requestLogger.js';
import apiRoutes from './routes/index.js';

/**
 * Builds the Express app without listening or connecting to the database,
 * so tests can drive it with supertest. server.js owns the process lifecycle.
 */
export function createApp({ config = getConfig(), logger = getLogger() } = {}) {
  const app = express();
  // Express 5's default, pinned explicitly: ?status[$ne]=x stays the literal key "status[$ne]"
  // instead of becoming { status: { $ne: 'x' } }, which could be passed into a Mongo filter.
  app.set('query parser', 'simple');

  // 1. Request id + logging first, so every later log line (including errors) carries the id.
  app.use(requestLogger(logger));
  // 2. Security headers (also removes X-Powered-By).
  app.use(helmet());
  // 3. Only known frontends may call the API from a browser. Auth uses a Bearer header,
  //    not cookies, so credentials stay disabled.
  app.use(cors({ origin: [...config.corsOrigins], exposedHeaders: [REQUEST_ID_HEADER, 'Idempotent-Replayed'] }));
  // 4. Body parsing after logging so malformed-JSON errors still have a request id.
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.use('/api', apiRoutes);

  // 5. Unmatched routes, then the error handler last (Express identifies it by 4 params).
  app.use(notFound);
  app.use(createErrorHandler({ logger }));

  return app;
}
