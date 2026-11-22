import { z } from 'zod';
import type { SupplierHotel } from '../types';
import type { SupplierDefinition } from './registry';

const supplierHotelsSchema = z.array(
  z.object({
    hotelId: z.string().min(1),
    name: z.string().trim().min(1),
    price: z.number().finite().nonnegative(),
    city: z.string().min(1),
    commissionPct: z.number().finite().min(0).max(100),
  }),
);

/**
 * - unavailable:      network error, timeout, 5xx or 429 — worth retrying
 * - rejected:         other 4xx — our request is wrong, retrying will not help
 * - invalid_response: the supplier answered with something we cannot use
 */
export type SupplierErrorKind = 'unavailable' | 'rejected' | 'invalid_response';

export class SupplierRequestError extends Error {
  override readonly name = 'SupplierRequestError';

  constructor(
    message: string,
    readonly kind: SupplierErrorKind,
    readonly httpStatus?: number,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.kind === 'unavailable';
  }
}

export interface SupplierRequest {
  baseUrl: string;
  supplier: SupplierDefinition;
  city?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return `timed out after ${timeoutMs}ms`;
    if (err.name === 'AbortError') return 'request was cancelled';
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ?? cause?.message ?? err.message;
  }
  return String(err);
}

export async function requestSupplierHotels(req: SupplierRequest): Promise<SupplierHotel[]> {
  const { supplier, timeoutMs } = req;
  const url = new URL(supplier.path, req.baseUrl);
  if (req.city) url.searchParams.set('city', req.city);

  const signals = [AbortSignal.timeout(timeoutMs)];
  if (req.signal) signals.push(req.signal);

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any(signals) });
  } catch (err) {
    throw new SupplierRequestError(
      `${supplier.name} request failed: ${describeFetchError(err, timeoutMs)}`,
      'unavailable',
    );
  }

  if (!response.ok) {
    const kind: SupplierErrorKind = response.status >= 500 || response.status === 429 ? 'unavailable' : 'rejected';
    throw new SupplierRequestError(`${supplier.name} responded with HTTP ${response.status}`, kind, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SupplierRequestError(`${supplier.name} returned a non-JSON body`, 'invalid_response', response.status);
  }

  const parsed = supplierHotelsSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SupplierRequestError(
      `${supplier.name} returned an unexpected payload at "${issue?.path.join('.') || '<root>'}": ${issue?.message}`,
      'invalid_response',
      response.status,
    );
  }
  return parsed.data;
}
