// Shared types. This file must stay free of runtime imports: it is bundled into the Temporal workflow sandbox.

export type SupplierId = 'supplierA' | 'supplierB';

/** A hotel as returned by a supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** The best offer for one hotel, as returned to API clients. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}

export interface HotelSearchInput extends PriceRange {
  /** Lower-cased, trimmed city name. */
  city: string;
}

export interface SupplierOutcome {
  supplier: string;
  status: 'ok' | 'failed';
  hotelCount: number;
  error?: string;
}

export interface HotelSearchResult {
  city: string;
  hotels: HotelOffer[];
  suppliers: SupplierOutcome[];
}
