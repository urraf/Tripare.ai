import { describe, expect, it } from 'vitest';
import { selectBestOffers } from '../src/domain/selectBestOffers';
import { MOCK_HOTELS } from '../src/suppliers/mockData';

const forCity = (city: string) => [
  { supplier: 'Supplier A', hotels: MOCK_HOTELS.supplierA.filter((h) => h.city === city) },
  { supplier: 'Supplier B', hotels: MOCK_HOTELS.supplierB.filter((h) => h.city === city) },
];

describe('selectBestOffers', () => {
  it('dedupes delhi hotels and keeps the cheapest offer, sorted by price', () => {
    expect(selectBestOffers(forCity('delhi'))).toEqual([
      { name: 'Lemon Tree', price: 3200, supplier: 'Supplier B', commissionPct: 9 },
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
      { name: 'Hyatt Regency', price: 7200, supplier: 'Supplier A', commissionPct: 11 },
      { name: 'The Leela', price: 9800, supplier: 'Supplier B', commissionPct: 16 },
      { name: 'ITC Maurya', price: 11000, supplier: 'Supplier A', commissionPct: 14 },
      { name: 'Taj Palace', price: 11990, supplier: 'Supplier B', commissionPct: 14 },
    ]);
  });

  it('keeps hotels that only one supplier offers', () => {
    const result = selectBestOffers(forCity('bangalore'));
    expect(result.map((h) => [h.name, h.supplier])).toEqual([
      ['Holtin', 'Supplier A'],
      ['Radison', 'Supplier A'],
    ]);
  });

  it('matches names case- and whitespace-insensitively', () => {
    const result = selectBestOffers([
      { supplier: 'Supplier A', hotels: [{ hotelId: 'a', name: 'The  Leela', price: 100, city: 'x', commissionPct: 5 }] },
      { supplier: 'Supplier B', hotels: [{ hotelId: 'b', name: ' the leela ', price: 90, city: 'x', commissionPct: 5 }] },
    ]);
    expect(result).toEqual([{ name: 'the leela', price: 90, supplier: 'Supplier B', commissionPct: 5 }]);
  });

  it('breaks an exact price tie by higher commission, then by supplier order', () => {
    const tie = (commissionA: number, commissionB: number) =>
      selectBestOffers([
        { supplier: 'Supplier A', hotels: [{ hotelId: 'a', name: 'H', price: 100, city: 'x', commissionPct: commissionA }] },
        { supplier: 'Supplier B', hotels: [{ hotelId: 'b', name: 'H', price: 100, city: 'x', commissionPct: commissionB }] },
      ])[0].supplier;
    expect(tie(10, 15)).toBe('Supplier B');
    expect(tie(15, 10)).toBe('Supplier A');
    expect(tie(10, 10)).toBe('Supplier A');
  });

  it('returns an empty list when no supplier has hotels', () => {
    expect(selectBestOffers(forCity('paris'))).toEqual([]);
  });
});
