import { Router } from 'express';
import { z } from 'zod';
import type { HotelSearchGateway } from '../../temporal/hotelSearchGateway';
import { HttpError } from '../errors';

const priceParam = (name: string) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce
      .number({ invalid_type_error: `${name} must be a number` })
      .finite(`${name} must be a finite number`)
      .nonnegative(`${name} must be >= 0`)
      .optional(),
  );

export const hotelQuerySchema = z
  .object({
    city: z
      .string({ required_error: 'city is required', invalid_type_error: 'city must be a single value' })
      .trim()
      .toLowerCase()
      .min(1, 'city is required')
      .max(60, 'city is too long')
      .regex(/^[a-z][a-z .'-]*$/, 'city may only contain letters, spaces, dots, apostrophes and hyphens'),
    minPrice: priceParam('minPrice'),
    maxPrice: priceParam('maxPrice'),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

export function createHotelsRouter(search: HotelSearchGateway): Router {
  const router = Router();

  // GET /api/hotels?city=delhi[&minPrice=..][&maxPrice=..]
  router.get('/api/hotels', async (req, res) => {
    const parsed = hotelQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'Invalid query parameters',
        parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
      );
    }

    const { workflowId, result } = await search.search(parsed.data);

    const failed = result.suppliers.filter((s) => s.status === 'failed').map((s) => s.supplier);
    res.set('X-Workflow-Id', workflowId);
    res.set('X-Result-Count', String(result.hotels.length));
    if (failed.length > 0) res.set('X-Suppliers-Unavailable', failed.join(', '));

    req.log.info(
      { city: result.city, workflowId, count: result.hotels.length, failedSuppliers: failed },
      'Hotel search served',
    );
    res.json(result.hotels);
  });

  return router;
}
