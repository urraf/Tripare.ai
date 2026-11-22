import type { SupplierHotel, SupplierId } from '../types';

/**
 * Static supplier inventories. Names overlap between A and B on purpose so the
 * orchestrator has something to compare:
 *  - delhi:     5 overlapping hotels (incl. an exact price tie on "The Leela"), 1 exclusive to each supplier
 *  - mumbai:    2 overlapping hotels, 1 exclusive to each supplier
 *  - bangalore: only Supplier A has inventory
 */
export const MOCK_HOTELS: Record<SupplierId, SupplierHotel[]> = {
  supplierA: [
    { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
    { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
    { hotelId: 'a3', name: 'Taj Palace', price: 12500, city: 'delhi', commissionPct: 15 },
    { hotelId: 'a4', name: 'The Leela', price: 9800, city: 'delhi', commissionPct: 12 },
    { hotelId: 'a5', name: 'ITC Maurya', price: 11000, city: 'delhi', commissionPct: 14 },
    { hotelId: 'a6', name: 'Hyatt Regency', price: 7200, city: 'delhi', commissionPct: 11 },
    { hotelId: 'a7', name: 'Trident', price: 8400, city: 'mumbai', commissionPct: 12 },
    { hotelId: 'a8', name: 'Taj Mahal Palace', price: 15000, city: 'mumbai', commissionPct: 15 },
    { hotelId: 'a9', name: 'Holtin', price: 6500, city: 'mumbai', commissionPct: 10 },
    { hotelId: 'a10', name: 'Radison', price: 5200, city: 'bangalore', commissionPct: 13 },
    { hotelId: 'a11', name: 'Holtin', price: 4800, city: 'bangalore', commissionPct: 9 },
  ],
  supplierB: [
    { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
    { hotelId: 'b2', name: 'Radison', price: 6150, city: 'delhi', commissionPct: 18 },
    { hotelId: 'b3', name: 'Taj Palace', price: 11990, city: 'delhi', commissionPct: 14 },
    { hotelId: 'b4', name: 'The Leela', price: 9800, city: 'delhi', commissionPct: 16 },
    { hotelId: 'b5', name: 'ITC Maurya', price: 11500, city: 'delhi', commissionPct: 10 },
    { hotelId: 'b6', name: 'Lemon Tree', price: 3200, city: 'delhi', commissionPct: 9 },
    { hotelId: 'b7', name: 'Trident', price: 8100, city: 'mumbai', commissionPct: 11 },
    { hotelId: 'b8', name: 'Taj Mahal Palace', price: 15400, city: 'mumbai', commissionPct: 18 },
    { hotelId: 'b9', name: 'Ginger', price: 2800, city: 'mumbai', commissionPct: 8 },
  ],
};
