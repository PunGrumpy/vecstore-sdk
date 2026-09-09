import {
  alreadyExists,
  connection,
  errorMessage,
  invalidArgument,
  notFound,
  providerError,
  unauthorized,
  unsupported,
} from "../errors";
import type { VecstoreError } from "../errors";
import { compilePineconeFilter } from "../filter/pinecone";
import type { PineconeFilter } from "../filter/pinecone";
import { attempt } from "../internal/attempt";
import { chunk, sortByIds } from "../internal/collections";
import type {
  DeleteSelector,
  FetchOptions,
  IndexOptions,
  IndexSpec,
  MetadataValue,
  Metric,
  QueryOptions,
  ScoredRecord,
  VecResult,
  VectorIndex,
  VectorRecord,
  VectorStore,
} from "../types";

export {
  compilePineconeFilter,
  type PineconeFilter,
  type PineconeOperator,
} from "../filter/pinecone";

export type PineconeMetric = "cosine" | "euclidean" | "dotproduct";

export interface PineconeRecordLike {
  readonly id: string;
  readonly values?: number[];
  readonly metadata?: Record<string, MetadataValue>;
}

export interface PineconeScoredRecordLike extends PineconeRecordLike {
  readonly score?: number;
}

export interface PineconeIndexDescription {
  readonly name: string;
}

export interface PineconeIndexSpec {
  readonly serverless?: { readonly cloud: string; readonly region: string };
  readonly pod?: {
    readonly environment: string;
    readonly podType: string;
    readonly pods?: number;
    readonly replicas?: number;
    readonly shards?: number;
  };
}

export interface PineconeIndexLike {
  readonly upsert: (options: {
    records: PineconeRecordLike[];
    namespace?: string;
  }) => Promise<void>;
  readonly query: (options: {
    vector: number[];
    topK: number;
    filter?: PineconeFilter;
    includeMetadata?: boolean;
    includeValues?: boolean;
    namespace?: string;
  }) => Promise<{ matches: PineconeScoredRecordLike[] }>;
  readonly fetch: (options: {
    ids: string[];
    namespace?: string;
  }) => Promise<{ records: Record<string, PineconeRecordLike> }>;
  readonly deleteMany: (options: {
    ids?: string[];
    filter?: PineconeFilter;
    namespace?: string;
  }) => Promise<void>;
  readonly deleteAll: (options?: { namespace?: string }) => Promise<void>;
}

export interface PineconeCreateIndexOptions {
  readonly name: string;
  readonly dimension: number;
  readonly metric: PineconeMetric;
  readonly spec: PineconeIndexSpec;
  readonly waitUntilReady?: boolean;
}

export interface PineconeClientLike<CreateIndexResult = void> {
  readonly index: (options: { name: string }) => PineconeIndexLike;
  readonly listIndexes: () => Promise<{ indexes?: PineconeIndexDescription[] }>;
  readonly createIndex: (
    options: PineconeCreateIndexOptions
  ) => Promise<CreateIndexResult>;
  readonly deleteIndex: (name: string) => Promise<void>;
}

export type PineconeCreateIndexResult<Client> = Client extends {
  readonly createIndex: (...args: never[]) => Promise<infer Result>;
}
  ? Result
  : never;

export interface PineconeStoreOptions<Client> {
  readonly client: Client;
  readonly indexSpec?: PineconeIndexSpec;
}

const PROVIDER = "pinecone";
const UPSERT_BATCH = 100;
const FETCH_BATCH = 1000;
const DEFAULT_SPEC: PineconeIndexSpec = {
  serverless: { cloud: "aws", region: "us-east-1" },
};

const METRICS: Record<Metric, PineconeMetric> = {
  cosine: "cosine",
  dot: "dotproduct",
  euclidean: "euclidean",
};

const CONNECTION_ERRORS = new Set([
  "PineconeConnectionError",
  "PineconeUnableToResolveHostError",
  "PineconeTimeoutError",
  "PineconeMaxRetriesExceededError",
  "PineconeUnavailableError",
]);

const INVALID_ARGUMENT_ERRORS = new Set([
  "PineconeBadRequestError",
  "PineconeArgumentError",
  "PineconeUnprocessableEntityError",
]);

interface ErrorContext {
  readonly index: string;
  readonly feature?: string;
}

export const normalizePineconeError = (
  cause: unknown,
  context: ErrorContext
): VecstoreError => {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "PineconeNotFoundError") {
    return notFound(PROVIDER, context.index, cause);
  }
  if (name === "PineconeConflictError") {
    return alreadyExists(PROVIDER, context.index, cause);
  }
  if (name === "PineconeAuthorizationError") {
    return unauthorized(PROVIDER, cause);
  }
  if (CONNECTION_ERRORS.has(name)) {
    return connection(PROVIDER, cause);
  }
  if (INVALID_ARGUMENT_ERRORS.has(name)) {
    if (context.feature !== undefined && name === "PineconeBadRequestError") {
      return unsupported(PROVIDER, context.feature, errorMessage(cause));
    }
    return invalidArgument(PROVIDER, errorMessage(cause), cause);
  }
  return providerError(PROVIDER, cause);
};

const run = <T>(
  context: ErrorContext,
  action: () => Promise<T>
): VecResult<T> =>
  attempt((cause) => normalizePineconeError(cause, context), action);

const namespaceArgs = (
  namespace: string | undefined
): { namespace?: string } =>
  namespace === undefined || namespace === "" ? {} : { namespace };

const toPineconeRecord = (record: VectorRecord): PineconeRecordLike => ({
  id: record.id,
  metadata: record.metadata,
  values: [...record.vector],
});

const toVectorRecord = (
  record: PineconeRecordLike,
  includeVector: boolean
): VectorRecord => ({
  id: record.id,
  metadata: record.metadata ?? {},
  vector: includeVector ? (record.values ?? []) : [],
});

const recordsOf = (
  response: { records: Record<string, PineconeRecordLike> },
  includeVector: boolean
): VectorRecord[] =>
  Object.values(response.records).map((record) =>
    toVectorRecord(record, includeVector)
  );

const toScoredRecord = (match: PineconeScoredRecordLike): ScoredRecord => ({
  id: match.id,
  metadata: match.metadata,
  score: match.score ?? 0,
  vector: match.values,
});

const createIndex = (
  client: Pick<PineconeClientLike, "index">,
  name: string,
  options: IndexOptions
): VectorIndex => {
  const target = client.index({ name });
  const scope = namespaceArgs(options.namespace);
  const context: ErrorContext = { index: name };
  return {
    delete: (selector: DeleteSelector) => {
      if ("ids" in selector) {
        return run(context, () =>
          target.deleteMany({ ...scope, ids: [...selector.ids] })
        );
      }
      if ("filter" in selector) {
        return run({ ...context, feature: "deleteByFilter" }, () =>
          target.deleteMany({
            ...scope,
            filter: compilePineconeFilter(selector.filter),
          })
        );
      }
      return run(context, () => target.deleteAll(scope));
    },

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(context, async () => {
        const includeVector = fetchOptions.includeVector ?? false;
        const responses = await Promise.all(
          chunk(ids, FETCH_BATCH).map((batch) =>
            target.fetch({ ...scope, ids: batch })
          )
        );
        const records = responses.flatMap((response) =>
          recordsOf(response, includeVector)
        );
        return sortByIds(ids, records);
      }),

    name,

    namespace: options.namespace,

    query: (query: QueryOptions) =>
      run(context, async () => {
        const response = await target.query({
          ...scope,
          filter:
            query.filter === undefined
              ? undefined
              : compilePineconeFilter(query.filter),
          includeMetadata: query.includeMetadata ?? true,
          includeValues: query.includeVector ?? false,
          topK: query.topK,
          vector: [...query.vector],
        });
        return response.matches.map(toScoredRecord);
      }),

    upsert: (records) =>
      run(context, async () => {
        await Promise.all(
          chunk(records, UPSERT_BATCH).map((batch) =>
            target.upsert({ ...scope, records: batch.map(toPineconeRecord) })
          )
        );
      }),
  };
};

export const createPineconeStore = <
  Client extends PineconeClientLike<PineconeCreateIndexResult<Client>>,
>(
  options: PineconeStoreOptions<Client>
): VectorStore<Client> => {
  const { client } = options;
  const spec = options.indexSpec ?? DEFAULT_SPEC;
  return {
    createIndex: (indexSpec: IndexSpec) =>
      run({ index: indexSpec.name }, async () => {
        await client.createIndex({
          dimension: indexSpec.dimension,
          metric: METRICS[indexSpec.metric ?? "cosine"],
          name: indexSpec.name,
          spec,
          waitUntilReady: true,
        });
      }),

    deleteIndex: (name) => run({ index: name }, () => client.deleteIndex(name)),

    index: (name, indexOptions = {}) => createIndex(client, name, indexOptions),

    listIndexes: () =>
      run({ index: "" }, async () => {
        const response = await client.listIndexes();
        return (response.indexes ?? []).map((index) => index.name);
      }),

    provider: PROVIDER,

    raw: client,
  };
};
