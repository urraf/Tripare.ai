function readString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

export const config = {
  serviceName: readString('SERVICE_NAME', 'hotel-offer-orchestrator'),
  logLevel: readString('LOG_LEVEL', 'info'),
  port: readInt('PORT', 3000),

  temporal: {
    address: readString('TEMPORAL_ADDRESS', 'localhost:7233'),
    namespace: readString('TEMPORAL_NAMESPACE', 'default'),
    taskQueue: readString('TEMPORAL_TASK_QUEUE', 'hotel-offers'),
    /** Upper bound for a single search workflow, so a request never hangs (e.g. no worker running). */
    workflowTimeoutMs: readInt('WORKFLOW_TIMEOUT_MS', 15_000),
  },

  redis: {
    url: readString('REDIS_URL', 'redis://localhost:6379'),
    hotelsTtlSeconds: readInt('HOTELS_TTL_SECONDS', 3600),
  },

  suppliers: {
    /** Where the (mock) supplier APIs live. In Docker this is the API container. */
    baseUrl: readString('SUPPLIER_BASE_URL', 'http://localhost:3000'),
    timeoutMs: readInt('SUPPLIER_TIMEOUT_MS', 3000),
    healthTimeoutMs: readInt('SUPPLIER_HEALTH_TIMEOUT_MS', 2000),
    initiallyDown: {
      supplierA: readBool('SUPPLIER_A_DOWN', false),
      supplierB: readBool('SUPPLIER_B_DOWN', false),
    },
  },
} as const;

export type AppConfig = typeof config;
