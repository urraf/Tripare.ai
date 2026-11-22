import { Context, log } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import type { HotelStore } from '../store/hotelStore';
import { getSupplier } from '../suppliers/registry';
import { SupplierRequestError, requestSupplierHotels } from '../suppliers/supplierClient';
import type { HotelOffer, PriceRange, SupplierHotel, SupplierId } from '../types';

/** Failure types the workflow's retry policy knows about. */
export const FailureTypes = {
  SupplierUnavailable: 'SupplierUnavailable',
  SupplierRejected: 'SupplierRejected',
  SupplierInvalidResponse: 'SupplierInvalidResponse',
  UnknownSupplier: 'UnknownSupplier',
  AllSuppliersUnavailable: 'AllSuppliersUnavailable',
} as const;

const failureTypeByKind = {
  unavailable: FailureTypes.SupplierUnavailable,
  rejected: FailureTypes.SupplierRejected,
  invalid_response: FailureTypes.SupplierInvalidResponse,
} as const;

export interface ActivityDeps {
  store: Pick<HotelStore, 'save' | 'findByPrice'>;
  supplierBaseUrl: string;
  supplierTimeoutMs: number;
}

export function createActivities(deps: ActivityDeps) {
  return {
    /** Calls one supplier's API and returns its hotels for the city. */
    async fetchSupplierHotels(supplierId: SupplierId, city: string): Promise<SupplierHotel[]> {
      const supplier = getSupplier(supplierId);
      if (!supplier) {
        throw ApplicationFailure.nonRetryable(`Unknown supplier "${supplierId}"`, FailureTypes.UnknownSupplier);
      }

      const { info, cancellationSignal } = Context.current();
      const startedAt = Date.now();
      try {
        const hotels = await requestSupplierHotels({
          baseUrl: deps.supplierBaseUrl,
          supplier,
          city,
          timeoutMs: deps.supplierTimeoutMs,
          signal: cancellationSignal,
        });
        // Don't trust the supplier to have applied the city filter.
        const forCity = hotels.filter((hotel) => hotel.city.trim().toLowerCase() === city);
        log.info('Fetched supplier hotels', {
          supplier: supplier.name,
          city,
          hotelCount: forCity.length,
          attempt: info.attempt,
          durationMs: Date.now() - startedAt,
        });
        return forCity;
      } catch (err) {
        if (err instanceof SupplierRequestError) {
          log.warn('Supplier request failed', {
            supplier: supplier.name,
            city,
            attempt: info.attempt,
            kind: err.kind,
            httpStatus: err.httpStatus,
            error: err.message,
            durationMs: Date.now() - startedAt,
          });
          throw ApplicationFailure.create({
            message: err.message,
            type: failureTypeByKind[err.kind],
            nonRetryable: !err.retryable,
            details: [{ supplier: supplier.name, httpStatus: err.httpStatus ?? null }],
          });
        }
        log.error('Unexpected error while fetching supplier hotels', { supplier: supplier.name, city, error: String(err) });
        throw err;
      }
    },

    /** Stores the deduplicated list for a city in Redis (replacing any previous list). */
    async saveHotels(city: string, hotels: HotelOffer[]): Promise<void> {
      try {
        await deps.store.save(city, hotels);
        log.info('Saved deduplicated hotels to Redis', { city, hotelCount: hotels.length });
      } catch (err) {
        log.error('Failed to save hotels to Redis', { city, error: String(err) });
        throw err;
      }
    },

    /** Price-range query executed inside Redis (sorted set + Lua). */
    async filterHotelsByPrice(city: string, range: PriceRange): Promise<HotelOffer[]> {
      try {
        const hotels = await deps.store.findByPrice(city, range);
        log.info('Filtered hotels by price in Redis', { city, ...range, hotelCount: hotels.length });
        return hotels;
      } catch (err) {
        log.error('Failed to filter hotels in Redis', { city, ...range, error: String(err) });
        throw err;
      }
    },
  };
}

export type HotelActivities = ReturnType<typeof createActivities>;
