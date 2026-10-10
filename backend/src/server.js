import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { EnvValidationError, getConfig } from './config/env.js';
import { getLogger } from './config/logger.js';

// Requests still in flight get this long to finish before we force the exit.
const SHUTDOWN_TIMEOUT_MS = 10000;

function loadConfigOrExit() {
  try {
    return getConfig();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      // The logger depends on config, so this is the one place we write to stderr directly.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

async function main() {
  const config = loadConfigOrExit();
  const logger = getLogger();

  // After an unexpected error the process state is unknown; crash and let the supervisor restart it.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection, exiting');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception, exiting');
    process.exit(1);
  });

  try {
    await connectDatabase(config.mongodbUri, { logger });
  } catch (err) {
    logger.fatal({ err }, 'Could not connect to MongoDB. Check MONGODB_URI and network access, then restart.');
    process.exit(1);
  }
  logger.info('MongoDB connected');

  const app = createApp({ config, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Everest backend listening');
  });
  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error (is the port already in use?)');
    process.exit(1);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: no new connections, finishing in-flight requests');

    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    server.close(async (err) => {
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(err ? 1 : 0);
    });
    server.closeIdleConnections();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
