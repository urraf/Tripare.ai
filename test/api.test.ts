import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app';
import { createSupplierRouter, SupplierSimulator } from '../src/suppliers/mockRouter';
import { SearchError, type HotelSearchGateway } from '../src/temporal/hotelSearchGateway';
import type { HotelSearchInput } from '../src/types';

// The health check calls the suppliers over HTTP, so serve them from a real port.
const simulator = new SupplierSimulator();
let supplierServer: Server;
let supplierBaseUrl: string;

beforeAll(async () => {
  const supplierApp = express().use(createSupplierRouter(simulator));
  supplierServer = supplierApp.listen(0);
  await new Promise((resolve) => supplierServer.once('listening', resolve));
  supplierBaseUrl = `http://127.0.0.1:${(supplierServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  supplierServer.close();
});

beforeEach(() => {
  simulator.setDown('supplierA', false);
  simulator.setDown('supplierB', false);
});

function buildApp(overrides: Partial<HotelSearchGateway> = {}, pingRedis = async () => 'PONG') {
  const search: HotelSearchGateway = {
    search: vi.fn(async (input: HotelSearchInput) => ({
      workflowId: 'wf-1',
      result: {
        city: input.city,
        hotels: [{ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 }],
        suppliers: [
          { supplier: 'Supplier A', status: 'ok' as const, hotelCount: 6 },
          { supplier: 'Supplier B', status: 'ok' as const, hotelCount: 6 },
        ],
      },
    })),
    health: vi.fn(async () => ({ workerPollers: 1 })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
  const app = createApp({ search, simulator, pingRedis, supplierBaseUrl, supplierHealthTimeoutMs: 1000 });
  return { app, search };
}

describe('GET /api/hotels', () => {
  it('runs the search with a normalized city and returns the hotel array', async () => {
    const { app, search } = buildApp();
    const res = await request(app).get('/api/hotels').query({ city: '  Delhi ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 }]);
    expect(res.headers['x-workflow-id']).toBe('wf-1');
    expect(search.search).toHaveBeenCalledWith({ city: 'delhi' });
  });

  it('passes the price range through as numbers', async () => {
    const { app, search } = buildApp();
    await request(app).get('/api/hotels?city=delhi&minPrice=5000&maxPrice=10000').expect(200);
    expect(search.search).toHaveBeenCalledWith({ city: 'delhi', minPrice: 5000, maxPrice: 10000 });
  });

  it.each([
    ['/api/hotels', 'city'],
    ['/api/hotels?city=', 'city'],
    ['/api/hotels?city=d3lhi', 'city'],
    ['/api/hotels?city=delhi&minPrice=abc', 'minPrice'],
    ['/api/hotels?city=delhi&maxPrice=-1', 'maxPrice'],
    ['/api/hotels?city=delhi&minPrice=9000&maxPrice=1000', 'minPrice'],
    ['/api/hotels?city=delhi&city=mumbai', 'city'],
  ])('rejects %s with 400', async (url, field) => {
    const { app, search } = buildApp();
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    expect(search.search).not.toHaveBeenCalled();
  });

  it('flags a degraded result with the X-Suppliers-Unavailable header', async () => {
    const { app } = buildApp({
      search: async () => ({
        workflowId: 'wf-2',
        result: {
          city: 'delhi',
          hotels: [],
          suppliers: [
            { supplier: 'Supplier A', status: 'ok', hotelCount: 0 },
            { supplier: 'Supplier B', status: 'failed', hotelCount: 0, error: 'HTTP 503' },
          ],
        },
      }),
    });
    const res = await request(app).get('/api/hotels?city=delhi');
    expect(res.status).toBe(200);
    expect(res.headers['x-suppliers-unavailable']).toBe('Supplier B');
  });

  it.each([
    ['ALL_SUPPLIERS_UNAVAILABLE', 502],
    ['SEARCH_TIMEOUT', 504],
    ['WORKFLOW_ENGINE_UNAVAILABLE', 503],
    ['SEARCH_FAILED', 500],
  ] as const)('maps %s to HTTP %i', async (code, status) => {
    const { app } = buildApp({
      search: async () => {
        throw new SearchError(code, 'boom');
      },
    });
    const res = await request(app).get('/api/hotels?city=delhi');
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });
});

describe('mock suppliers', () => {
  it('serves hotels filtered by city', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/supplierA/hotels?city=delhi').expect(200);
    expect(res.body).toHaveLength(6);
    expect(res.body.every((h: { city: string }) => h.city === 'delhi')).toBe(true);
    expect(res.body[0]).toEqual({ hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 });
  });

  it('can be switched down and up again', async () => {
    const { app } = buildApp();
    await request(app).put('/admin/suppliers/supplierB/status').send({ status: 'down' }).expect(200);
    await request(app).get('/supplierB/hotels').expect(503);
    await request(app).put('/admin/suppliers/supplierB/status').send({ status: 'up' }).expect(200);
    await request(app).get('/supplierB/hotels').expect(200);
  });

  it('validates the admin request', async () => {
    const { app } = buildApp();
    await request(app).put('/admin/suppliers/supplierZ/status').send({ status: 'down' }).expect(404);
    await request(app).put('/admin/suppliers/supplierA/status').send({ status: 'sideways' }).expect(400);
  });
});

describe('GET /health', () => {
  it('reports ok when everything is up', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.suppliers['Supplier A'].status).toBe('up');
    expect(res.body.suppliers['Supplier B'].status).toBe('up');
    expect(res.body.dependencies.worker).toMatchObject({ status: 'up', pollers: 1 });
  });

  it('reports degraded when one supplier is down', async () => {
    simulator.setDown('supplierA', true);
    const { app } = buildApp();
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.suppliers['Supplier A']).toMatchObject({ status: 'down', error: 'Supplier A responded with HTTP 503' });
  });

  it('reports down (503) when both suppliers are down', async () => {
    simulator.setDown('supplierA', true);
    simulator.setDown('supplierB', true);
    const res = await request(buildApp().app).get('/health').expect(503);
    expect(res.body.status).toBe('down');
  });

  it('reports down when Redis or the worker is unavailable', async () => {
    const noRedis = buildApp({}, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect((await request(noRedis.app).get('/health')).body.dependencies.redis.status).toBe('down');

    const noWorker = buildApp({ health: async () => ({ workerPollers: 0 }) });
    const res = await request(noWorker.app).get('/health').expect(503);
    expect(res.body.dependencies.worker.status).toBe('down');
  });
});
