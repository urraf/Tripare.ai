import path from 'node:path';
import { ApplicationFailure } from '@temporalio/common';
import { WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HotelActivities } from '../src/temporal/activities';
import { hotelOffersWorkflow } from '../src/temporal/workflows';
import { MOCK_HOTELS } from '../src/suppliers/mockData';
import type { HotelOffer, SupplierId } from '../src/types';

let env: TestWorkflowEnvironment;
let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('ERROR', () => {}) });
  env = await TestWorkflowEnvironment.createTimeSkipping();
  workflowBundle = await bundleWorkflowCode({
    workflowsPath: path.join(__dirname, '../src/temporal/workflows.ts'),
    logger: new DefaultLogger('WARN'),
  });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

function fakeActivities(downSuppliers: SupplierId[] = []) {
  let saved: HotelOffer[] = [];
  const activities: HotelActivities = {
    fetchSupplierHotels: vi.fn(async (supplierId: SupplierId, city: string) => {
      if (downSuppliers.includes(supplierId)) {
        throw ApplicationFailure.retryable(`${supplierId} responded with HTTP 503`, 'SupplierUnavailable');
      }
      return MOCK_HOTELS[supplierId].filter((h) => h.city === city);
    }),
    saveHotels: vi.fn(async (_city: string, hotels: HotelOffer[]) => {
      saved = hotels;
    }),
    filterHotelsByPrice: vi.fn(async (_city, { minPrice = -Infinity, maxPrice = Infinity }) =>
      saved.filter((h) => h.price >= minPrice && h.price <= maxPrice),
    ),
  };
  return activities;
}

async function run(activities: HotelActivities, input: Parameters<typeof hotelOffersWorkflow>[0]) {
  const taskQueue = `test-${Math.random().toString(36).slice(2)}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities,
  });
  return worker.runUntil(
    env.client.workflow.execute(hotelOffersWorkflow, { taskQueue, workflowId: `wf-${taskQueue}`, args: [input] }),
  );
}

describe('hotelOffersWorkflow', () => {
  it('calls both suppliers, dedupes, saves to Redis and returns the best offers', async () => {
    const activities = fakeActivities();
    const result = await run(activities, { city: 'delhi' });

    expect(activities.fetchSupplierHotels).toHaveBeenCalledWith('supplierA', 'delhi');
    expect(activities.fetchSupplierHotels).toHaveBeenCalledWith('supplierB', 'delhi');
    expect(result.hotels).toHaveLength(7);
    expect(result.hotels.slice(0, 3)).toEqual([
      { name: 'Lemon Tree', price: 3200, supplier: 'Supplier B', commissionPct: 9 },
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
    ]);
    expect(activities.saveHotels).toHaveBeenCalledWith('delhi', result.hotels);
    expect(activities.filterHotelsByPrice).not.toHaveBeenCalled();
    expect(result.suppliers.every((s) => s.status === 'ok')).toBe(true);
  });

  it('filters by price through the Redis activity when a range is given', async () => {
    const activities = fakeActivities();
    const result = await run(activities, { city: 'delhi', minPrice: 5000, maxPrice: 10000 });

    expect(activities.filterHotelsByPrice).toHaveBeenCalledWith('delhi', { minPrice: 5000, maxPrice: 10000 });
    expect(result.hotels.map((h) => h.name)).toEqual(['Holtin', 'Radison', 'Hyatt Regency', 'The Leela']);
  });

  it('retries a failing supplier, then continues with the other one', async () => {
    const activities = fakeActivities(['supplierB']);
    const result = await run(activities, { city: 'delhi' });

    const supplierBCalls = vi.mocked(activities.fetchSupplierHotels).mock.calls.filter(([id]) => id === 'supplierB');
    expect(supplierBCalls).toHaveLength(3); // maximumAttempts
    expect(result.hotels.every((h) => h.supplier === 'Supplier A')).toBe(true);
    expect(result.hotels).toHaveLength(6);
    expect(result.suppliers).toEqual([
      { supplier: 'Supplier A', status: 'ok', hotelCount: 6 },
      { supplier: 'Supplier B', status: 'failed', hotelCount: 0, error: 'supplierB responded with HTTP 503' },
    ]);
  });

  it('fails with AllSuppliersUnavailable when every supplier is down', async () => {
    const activities = fakeActivities(['supplierA', 'supplierB']);
    const error = await run(activities, { city: 'delhi' }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(WorkflowFailedError);
    const cause = (error as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as ApplicationFailure).type).toBe('AllSuppliersUnavailable');
    expect(activities.saveHotels).not.toHaveBeenCalled();
  });

  it('returns an empty list (and still saves it) for a city with no hotels', async () => {
    const activities = fakeActivities();
    const result = await run(activities, { city: 'paris' });
    expect(result.hotels).toEqual([]);
    expect(activities.saveHotels).toHaveBeenCalledWith('paris', []);
  });
});
