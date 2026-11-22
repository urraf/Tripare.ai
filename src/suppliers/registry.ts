// Deterministic constants only: imported by the Temporal workflow.
import type { SupplierId } from '../types';

export interface SupplierDefinition {
  id: SupplierId;
  name: string;
  path: string;
}

export const SUPPLIERS: readonly SupplierDefinition[] = [
  { id: 'supplierA', name: 'Supplier A', path: '/supplierA/hotels' },
  { id: 'supplierB', name: 'Supplier B', path: '/supplierB/hotels' },
];

export function getSupplier(id: string): SupplierDefinition | undefined {
  return SUPPLIERS.find((supplier) => supplier.id === id);
}
