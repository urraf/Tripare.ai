// Pure, deterministic logic: runs inside the Temporal workflow sandbox.
import type { HotelOffer, SupplierHotel } from '../types';

export interface SupplierListing {
  supplier: string;
  hotels: SupplierHotel[];
}

/** "  The  Leela " and "the leela" are the same hotel. */
export function normalizeHotelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Lower price wins. On an exact price tie the offer with the higher commission wins
 * (better margin for us at the same customer price). A remaining tie keeps the
 * offer seen first, i.e. supplier order.
 */
function isBetterOffer(candidate: HotelOffer, current: HotelOffer): boolean {
  if (candidate.price !== current.price) return candidate.price < current.price;
  return candidate.commissionPct > current.commissionPct;
}

/** Price ascending, then normalized name — the same order Redis returns from the price index. */
export function compareOffers(a: HotelOffer, b: HotelOffer): number {
  if (a.price !== b.price) return a.price - b.price;
  const nameA = normalizeHotelName(a.name);
  const nameB = normalizeHotelName(b.name);
  return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
}

/** Dedupe hotels across suppliers by name and keep the best offer for each. */
export function selectBestOffers(listings: SupplierListing[]): HotelOffer[] {
  const best = new Map<string, HotelOffer>();

  for (const { supplier, hotels } of listings) {
    for (const hotel of hotels) {
      const key = normalizeHotelName(hotel.name);
      const candidate: HotelOffer = {
        name: hotel.name.trim().replace(/\s+/g, ' '),
        price: hotel.price,
        supplier,
        commissionPct: hotel.commissionPct,
      };
      const current = best.get(key);
      if (!current || isBetterOffer(candidate, current)) {
        best.set(key, candidate);
      }
    }
  }

  return [...best.values()].sort(compareOffers);
}
