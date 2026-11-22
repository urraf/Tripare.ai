import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../logger';
import { createSupplierRouter, type SupplierSimulator } from '../suppliers/mockRouter';
import type { HotelSearchGateway } from '../temporal/hotelSearchGateway';
import { errorHandler, notFoundHandler } from './errors';
import { createHealthRouter } from './routes/health';
import { createHotelsRouter } from './routes/hotels';

export interface AppDeps {
  search: HotelSearchGateway;
  simulator: SupplierSimulator;
  pingRedis: () => Promise<unknown>;
  supplierBaseUrl: string;
  supplierHealthTimeoutMs: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/livez' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.use(createHealthRouter(deps));
  app.use(createSupplierRouter(deps.simulator));
  app.use(createHotelsRouter(deps.search));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
