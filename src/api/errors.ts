import type { ErrorRequestHandler, RequestHandler } from 'express';
import { SearchError, type SearchErrorCode } from '../temporal/hotelSearchGateway';

export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const statusBySearchError: Record<SearchErrorCode, number> = {
  ALL_SUPPLIERS_UNAVAILABLE: 502,
  SEARCH_TIMEOUT: 504,
  WORKFLOW_ENGINE_UNAVAILABLE: 503,
  SEARCH_FAILED: 500,
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof SearchError) {
    status = statusBySearchError[err.code];
    ({ code, message, details } = err);
  } else if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    // e.g. malformed JSON body from express.json()
    status = err.status;
    code = 'BAD_REQUEST';
    message = err.expose ? err.message : 'Bad request';
  }

  const log = req.log ?? console;
  if (status >= 500) log.error({ err, code }, 'Request failed');
  else log.warn({ code, message }, 'Request rejected');

  res.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) } });
};
