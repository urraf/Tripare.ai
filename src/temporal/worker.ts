import { existsSync } from 'node:fs';
import path from 'node:path';
import { DefaultLogger, NativeConnection, Runtime, Worker, type LogLevel } from '@temporalio/worker';
import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import { HotelStore } from '../store/hotelStore';
import { createActivities } from './activities';

const workerLogger = logger.child({ component: 'temporal-worker' });

// Route Temporal SDK, workflow and activity logs through pino as structured JSON.
const pinoMethod = { TRACE: 'trace', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' } as const;
const sdkLevel = (config.logLevel.toUpperCase() in pinoMethod ? config.logLevel.toUpperCase() : 'INFO') as LogLevel;
Runtime.install({
  logger: new DefaultLogger(sdkLevel, ({ level, message, meta }) => {
    workerLogger[pinoMethod[level]](meta ?? {}, message);
  }),
});

async function connectWithRetry(maxAttempts = 30): Promise<NativeConnection> {
  for (let attempt = 1; ; attempt++) {
    try {
      const connection = await NativeConnection.connect({ address: config.temporal.address });
      workerLogger.info({ address: config.temporal.address }, 'Connected to Temporal');
      return connection;
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      const delayMs = Math.min(1000 * attempt, 5000);
      workerLogger.warn({ err, attempt, delayMs }, 'Temporal not reachable yet, retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Production builds ship a pre-built workflow bundle (see src/scripts/bundleWorkflows.ts), which
 * avoids running webpack at startup — faster boot and much lower peak memory.
 * In development (tsx) there is no bundle, so the worker bundles the TypeScript source itself.
 */
function workflowSource(): { workflowBundle: { codePath: string } } | { workflowsPath: string } {
  const prebuilt = path.join(__dirname, '../workflow-bundle.js');
  if (existsSync(prebuilt)) {
    workerLogger.info({ codePath: prebuilt }, 'Using pre-built workflow bundle');
    return { workflowBundle: { codePath: prebuilt } };
  }
  return { workflowsPath: require.resolve('./workflows') };
}

async function main(): Promise<void> {
  const redis = new Redis(config.redis.url, { maxRetriesPerRequest: 2 });
  redis.on('error', (err) => workerLogger.warn({ err: err.message }, 'Redis connection error'));
  const store = new HotelStore(redis, config.redis.hotelsTtlSeconds);

  const connection = await connectWithRetry();
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.temporal.namespace,
      taskQueue: config.temporal.taskQueue,
      ...workflowSource(),
      activities: createActivities({
        store,
        supplierBaseUrl: config.suppliers.baseUrl,
        supplierTimeoutMs: config.suppliers.timeoutMs,
      }),
    });
    workerLogger.info(
      { taskQueue: config.temporal.taskQueue, namespace: config.temporal.namespace, supplierBaseUrl: config.suppliers.baseUrl },
      'Worker started',
    );
    // Resolves after SIGINT/SIGTERM once in-flight tasks have drained.
    await worker.run();
    workerLogger.info('Worker stopped');
  } finally {
    await connection.close();
    redis.disconnect();
  }
}

main().catch((err) => {
  workerLogger.fatal({ err }, 'Worker crashed');
  process.exit(1);
});
