import { ActivityFailure, ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers, type SupplierListing } from '../domain/selectBestOffers';
import { SUPPLIERS } from '../suppliers/registry';
import type { HotelSearchInput, HotelSearchResult, SupplierOutcome } from '../types';
// Type-only import: activity code never enters the workflow sandbox.
import type { HotelActivities } from './activities';

// Kept in sync with FailureTypes in ./activities (cannot import runtime values from there).
const NON_RETRYABLE_SUPPLIER_ERRORS = ['SupplierRejected', 'SupplierInvalidResponse', 'UnknownSupplier'];
const ALL_SUPPLIERS_UNAVAILABLE = 'AllSuppliersUnavailable';

const { fetchSupplierHotels } = proxyActivities<HotelActivities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
    maximumAttempts: 3,
    nonRetryableErrorTypes: NON_RETRYABLE_SUPPLIER_ERRORS,
  },
});

const { saveHotels, filterHotelsByPrice } = proxyActivities<HotelActivities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
    maximumAttempts: 5,
  },
});

function failureMessage(err: unknown): string {
  if (err instanceof ActivityFailure && err.cause) return err.cause.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 1. Call every supplier in parallel.
 * 2. Keep going if one supplier fails (after its retries); fail only if all fail.
 * 3. Dedupe by hotel name, keeping the cheapest offer.
 * 4. Save the deduplicated list to Redis.
 * 5. If a price range was requested, filter inside Redis.
 */
export async function hotelOffersWorkflow(input: HotelSearchInput): Promise<HotelSearchResult> {
  const { city, minPrice, maxPrice } = input;
  log.info('Hotel search started', { city, minPrice, maxPrice });

  const settled = await Promise.allSettled(SUPPLIERS.map((supplier) => fetchSupplierHotels(supplier.id, city)));

  const listings: SupplierListing[] = [];
  const suppliers: SupplierOutcome[] = [];
  settled.forEach((outcome, index) => {
    const supplier = SUPPLIERS[index];
    if (outcome.status === 'fulfilled') {
      listings.push({ supplier: supplier.name, hotels: outcome.value });
      suppliers.push({ supplier: supplier.name, status: 'ok', hotelCount: outcome.value.length });
    } else {
      const error = failureMessage(outcome.reason);
      log.warn('Supplier failed after retries; continuing without it', { city, supplier: supplier.name, error });
      suppliers.push({ supplier: supplier.name, status: 'failed', hotelCount: 0, error });
    }
  });

  if (listings.length === 0) {
    log.error('All suppliers failed', { city });
    throw ApplicationFailure.nonRetryable('All suppliers are unavailable', ALL_SUPPLIERS_UNAVAILABLE, suppliers);
  }

  const bestOffers = selectBestOffers(listings);
  await saveHotels(city, bestOffers);

  const hasPriceFilter = minPrice !== undefined || maxPrice !== undefined;
  const hotels = hasPriceFilter ? await filterHotelsByPrice(city, { minPrice, maxPrice }) : bestOffers;

  log.info('Hotel search completed', {
    city,
    uniqueHotels: bestOffers.length,
    returnedHotels: hotels.length,
    failedSuppliers: suppliers.filter((s) => s.status === 'failed').map((s) => s.supplier),
  });
  return { city, hotels, suppliers };
}
