import { Router } from 'express';
import { z } from 'zod';
import type { SupplierId } from '../types';
import { MOCK_HOTELS } from './mockData';
import { SUPPLIERS, getSupplier } from './registry';
import { HttpError } from '../api/errors';
import { logger } from '../logger';

/** In-memory switch used to simulate a supplier outage. */
export class SupplierSimulator {
  private readonly down = new Set<SupplierId>();

  constructor(initiallyDown: Partial<Record<SupplierId, boolean>> = {}) {
    for (const [id, isDown] of Object.entries(initiallyDown)) {
      if (isDown) this.down.add(id as SupplierId);
    }
  }

  isDown(id: SupplierId): boolean {
    return this.down.has(id);
  }

  setDown(id: SupplierId, isDown: boolean): void {
    if (isDown) this.down.add(id);
    else this.down.delete(id);
  }

  snapshot() {
    return SUPPLIERS.map((s) => ({ id: s.id, name: s.name, status: this.isDown(s.id) ? 'down' : 'up' }));
  }
}

const statusBodySchema = z.object({ status: z.enum(['up', 'down']) });

export function createSupplierRouter(simulator: SupplierSimulator): Router {
  const router = Router();

  // GET /supplierA/hotels and GET /supplierB/hotels (optional ?city= filter)
  for (const supplier of SUPPLIERS) {
    router.get(supplier.path, (req, res) => {
      if (simulator.isDown(supplier.id)) {
        res.status(503).json({ error: `${supplier.name} is unavailable (simulated outage)` });
        return;
      }
      const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : undefined;
      const hotels = MOCK_HOTELS[supplier.id].filter((hotel) => !city || hotel.city === city);
      res.json(hotels);
    });
  }

  // Outage simulation, used by the Postman collection.
  router.get('/admin/suppliers', (_req, res) => {
    res.json(simulator.snapshot());
  });

  router.put('/admin/suppliers/:supplierId/status', (req, res) => {
    const supplier = getSupplier(req.params.supplierId);
    if (!supplier) {
      throw new HttpError(404, 'SUPPLIER_NOT_FOUND', `Unknown supplier "${req.params.supplierId}"`);
    }
    const body = statusBodySchema.safeParse(req.body);
    if (!body.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Body must be {"status": "up" | "down"}');
    }
    simulator.setDown(supplier.id, body.data.status === 'down');
    logger.warn({ supplier: supplier.name, status: body.data.status }, 'Supplier status changed (simulation)');
    res.json({ id: supplier.id, name: supplier.name, status: body.data.status });
  });

  return router;
}
