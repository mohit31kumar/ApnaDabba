import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import initializeCronJobs from './cron/index';

const startServer = async () => {
  try {
    // Initialize cron jobs
    initializeCronJobs();

    // Start server
    app.listen(env.PORT, () => {
      logger.info(`Server running on http://localhost:${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
};

startServer();
