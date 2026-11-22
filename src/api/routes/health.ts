import { Router } from 'express';
import { SUPPLIERS } from '../../suppliers/registry';
import { requestSupplierHotels } from '../../suppliers/supplierClient';
import type { HotelSearchGateway } from '../../temporal/hotelSearchGateway';

export interface HealthDeps {
  search: Pick<HotelSearchGateway, 'health'>;
  pingRedis: () => Promise<unknown>;
  supplierBaseUrl: string;
  supplierHealthTimeoutMs: number;
}

type Status = 'up' | 'down';

interface ComponentHealth {
  status: Status;
  latencyMs: number;
  error?: string;
  [extra: string]: unknown;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe(fn: () => Promise<Record<string, unknown> | void>): Promise<ComponentHealth> {
  const startedAt = Date.now();
  try {
    const extra = (await fn()) ?? {};
    return { status: 'up', latencyMs: Date.now() - startedAt, ...extra };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - startedAt, error: err instanceof Error ? err.message : String(err) };
  }
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  // Liveness: the process is up. Used by the Docker healthcheck.
  router.get('/livez', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness / dependency health, including both suppliers.
  router.get('/health', async (_req, res) => {
    const timeoutMs = deps.supplierHealthTimeoutMs;

    const supplierChecks = SUPPLIERS.map((supplier) =>
      probe(async () => {
        const hotels = await requestSupplierHotels({ baseUrl: deps.supplierBaseUrl, supplier, timeoutMs });
        return { hotelCount: hotels.length };
      }).then((health) => [supplier.name, health] as const),
    );
    const redisCheck = probe(async () => {
      await withTimeout(deps.pingRedis(), timeoutMs, 'Redis ping');
    });
    const temporalCheck = (async () => {
      const startedAt = Date.now();
      try {
        const { workerPollers } = await withTimeout(deps.search.health(), timeoutMs, 'Temporal health check');
        const latencyMs = Date.now() - startedAt;
        return {
          temporal: { status: 'up', latencyMs } as ComponentHealth,
          worker: {
            status: workerPollers > 0 ? 'up' : 'down',
            latencyMs,
            pollers: workerPollers,
            ...(workerPollers > 0 ? {} : { error: 'No worker is polling the task queue' }),
          } as ComponentHealth,
        };
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const error = err instanceof Error ? err.message : String(err);
        return {
          temporal: { status: 'down', latencyMs, error } as ComponentHealth,
          worker: { status: 'down', latencyMs, error: 'Unknown: Temporal is unreachable' } as ComponentHealth,
        };
      }
    })();

    const [supplierResults, redis, { temporal, worker }] = await Promise.all([
      Promise.all(supplierChecks),
      redisCheck,
      temporalCheck,
    ]);

    const suppliers = Object.fromEntries(supplierResults);
    const suppliersUp = supplierResults.filter(([, h]) => h.status === 'up').length;
    const coreDown = [redis, temporal, worker].some((c) => c.status === 'down');

    const status = coreDown || suppliersUp === 0 ? 'down' : suppliersUp < SUPPLIERS.length ? 'degraded' : 'ok';

    res.status(status === 'down' ? 503 : 200).json({
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      suppliers,
      dependencies: { redis, temporal, worker },
    });
  });

  return router;
}
