import { randomUUID } from 'node:crypto';
import {
  ApplicationFailure,
  Client,
  Connection,
  TimeoutFailure,
  WorkflowFailedError,
} from '@temporalio/client';
import type { HotelSearchInput, HotelSearchResult } from '../types';
import type { hotelOffersWorkflow } from './workflows';

export type SearchErrorCode =
  | 'ALL_SUPPLIERS_UNAVAILABLE'
  | 'SEARCH_TIMEOUT'
  | 'WORKFLOW_ENGINE_UNAVAILABLE'
  | 'SEARCH_FAILED';

export class SearchError extends Error {
  override readonly name = 'SearchError';

  constructor(
    readonly code: SearchErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface SearchResponse {
  workflowId: string;
  result: HotelSearchResult;
}

export interface WorkflowEngineHealth {
  workerPollers: number;
}

/** What the HTTP layer needs from Temporal. Faked in tests. */
export interface HotelSearchGateway {
  search(input: HotelSearchInput): Promise<SearchResponse>;
  health(): Promise<WorkflowEngineHealth>;
  close(): Promise<void>;
}

export interface TemporalGatewayOptions {
  address: string;
  namespace: string;
  taskQueue: string;
  workflowTimeoutMs: number;
}

const TASK_QUEUE_TYPE_WORKFLOW = 1; // temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW

export class TemporalHotelSearchGateway implements HotelSearchGateway {
  private clientPromise?: Promise<Client>;

  constructor(private readonly options: TemporalGatewayOptions) {}

  /** Connects lazily and reconnects on the next call if the previous attempt failed. */
  private getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = Connection.connect({ address: this.options.address, connectTimeout: '5 seconds' })
        .then((connection) => new Client({ connection, namespace: this.options.namespace }))
        .catch((err: unknown) => {
          this.clientPromise = undefined;
          throw new SearchError('WORKFLOW_ENGINE_UNAVAILABLE', 'Cannot connect to Temporal', undefined, { cause: err });
        });
    }
    return this.clientPromise;
  }

  async search(input: HotelSearchInput): Promise<SearchResponse> {
    const client = await this.getClient();
    const workflowId = `hotel-search-${input.city.replace(/[^a-z0-9]+/g, '-')}-${randomUUID()}`;
    try {
      const result = await client.workflow.execute<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
        taskQueue: this.options.taskQueue,
        workflowId,
        args: [input],
        workflowExecutionTimeout: this.options.workflowTimeoutMs,
      });
      return { workflowId, result };
    } catch (err) {
      throw toSearchError(err, workflowId);
    }
  }

  async health(): Promise<WorkflowEngineHealth> {
    const client = await this.getClient();
    const response = await client.workflowService.describeTaskQueue({
      namespace: this.options.namespace,
      taskQueue: { name: this.options.taskQueue },
      taskQueueType: TASK_QUEUE_TYPE_WORKFLOW,
    });
    return { workerPollers: response.pollers?.length ?? 0 };
  }

  async close(): Promise<void> {
    const client = await this.clientPromise?.catch(() => undefined);
    await client?.connection.close();
  }
}

function toSearchError(err: unknown, workflowId: string): SearchError {
  if (err instanceof WorkflowFailedError) {
    const cause = err.cause;
    if (cause instanceof ApplicationFailure && cause.type === 'AllSuppliersUnavailable') {
      return new SearchError('ALL_SUPPLIERS_UNAVAILABLE', 'All hotel suppliers are currently unavailable', {
        workflowId,
        suppliers: cause.details?.[0],
      });
    }
    if (cause instanceof TimeoutFailure) {
      return new SearchError('SEARCH_TIMEOUT', 'Hotel search timed out (is the worker running?)', { workflowId });
    }
    return new SearchError('SEARCH_FAILED', cause?.message ?? err.message, { workflowId }, { cause: err });
  }
  if (err instanceof SearchError) return err;
  return new SearchError('WORKFLOW_ENGINE_UNAVAILABLE', 'Could not run the hotel search workflow', { workflowId }, { cause: err });
}
