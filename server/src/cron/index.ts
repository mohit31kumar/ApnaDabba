import cron from 'node-cron';
import { logger } from '../utils/logger';

export const initializeCronJobs = () => {
  logger.info('Initializing cron jobs');

  // Example: Daily cleanup job at 2 AM
  // cron.schedule('0 2 * * *', async () => {
  //   logger.info('Running daily cleanup job');
  //   // Add your cleanup logic here
  // });
};

export default initializeCronJobs;
