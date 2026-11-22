import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import { SupplierSimulator } from '../suppliers/mockRouter';
import { TemporalHotelSearchGateway } from '../temporal/hotelSearchGateway';
import { createApp } from './app';

const redis = new Redis(config.redis.url, { maxRetriesPerRequest: 1 });
redis.on('error', (err) => logger.warn({ err: err.message }, 'Redis connection error'));

const search = new TemporalHotelSearchGateway(config.temporal);

const simulator = new SupplierSimulator(config.suppliers.initiallyDown);

const app = createApp({
  search,
  simulator,
  pingRedis: () => redis.ping(),
  supplierBaseUrl: config.suppliers.baseUrl,
  supplierHealthTimeoutMs: config.suppliers.healthTimeoutMs,
});

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, temporal: config.temporal.address, taskQueue: config.temporal.taskQueue, suppliers: simulator.snapshot() },
    'API listening',
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down API');
  server.close();
  await Promise.allSettled([search.close(), redis.quit()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
