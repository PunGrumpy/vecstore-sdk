import {
  alreadyExists,
  connection,
  errorMessage,
  invalidArgument,
  notFound,
  providerError,
  unauthorized,
} from "../errors";
import type { VecstoreError } from "../errors";
import type { Filter } from "../filter/ast";
import { compileQdrantFilter } from "../filter/qdrant";
import type { QdrantCondition, QdrantFilter } from "../filter/qdrant";
import { attempt } from "../internal/attempt";
import { sortByIds } from "../internal/collections";
import { isNumberArray, isObjectLike, isString } from "../internal/guards";
import { isMetadataEntry, metadataFromEntries } from "../internal/metadata";
import type { MetadataEntry } from "../internal/metadata";
import { deterministicUuid, isUuid } from "../internal/uuid";
import type {
  DeleteSelector,
  FetchOptions,
  IndexOptions,
  IndexSpec,
  Metadata,
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
  compileQdrantFilter,
  type QdrantCondition,
  type QdrantFilter,
} from "../filter/qdrant";

export type QdrantDistance = "Cosine" | "Euclid" | "Dot";

export interface QdrantPoint {
  readonly id: string | number;
  readonly vector: number[];
  readonly payload?: Record<string, MetadataValue>;
}

export interface QdrantStoredPoint {
  readonly id: string | number;
  readonly payload?: object | null;
  readonly vector?: object | null;
}

export interface QdrantScoredPoint extends QdrantStoredPoint {
  readonly score: number;
}

export interface QdrantUpdateResult {
  readonly status: string;
}

export interface QdrantClientLike {
  readonly getCollections: () => Promise<{ collections: { name: string }[] }>;
  readonly createCollection: (
    name: string,
    args: { vectors: { size: number; distance: QdrantDistance } }
  ) => Promise<boolean>;
  readonly deleteCollection: (name: string) => Promise<boolean>;
  readonly createPayloadIndex: (
    name: string,
    args: {
      field_name: string;
      field_schema: { type: "keyword"; is_tenant: boolean };
      wait?: boolean;
    }
  ) => Promise<QdrantUpdateResult>;
  readonly upsert: (
    name: string,
    args: { wait?: boolean; points: QdrantPoint[] }
  ) => Promise<QdrantUpdateResult>;
  readonly query: (
    name: string,
    args: {
      query: number[];
      filter?: QdrantFilter;
      limit: number;
      with_payload: boolean;
      with_vector: boolean;
    }
  ) => Promise<{ points: QdrantScoredPoint[] }>;
  readonly retrieve: (
    name: string,
    args: {
      ids: (string | number)[];
      with_payload: boolean;
      with_vector: boolean;
    }
  ) => Promise<QdrantStoredPoint[]>;
  readonly delete: (
    name: string,
    args: { wait?: boolean } & (
      | { points: (string | number)[] }
      | { filter: QdrantFilter }
    )
  ) => Promise<QdrantUpdateResult>;
}

export interface QdrantStoreOptions<Client> {
  readonly client: Client;
}

export const QDRANT_ID_KEY = "_id";
export const QDRANT_NAMESPACE_KEY = "_namespace";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  QDRANT_ID_KEY,
  QDRANT_NAMESPACE_KEY,
]);
const ID_NAMESPACE = "vecstore-sdk/qdrant/point-id";
const PROVIDER = "qdrant";
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

const DISTANCES: Record<Metric, QdrantDistance> = {
  cosine: "Cosine",
  dot: "Dot",
  euclidean: "Euclid",
};

const toPointId = (namespace: string, id: string): string =>
  namespace === "" && isUuid(id)
    ? id
    : deterministicUuid(ID_NAMESPACE, `${namespace}/${id.length}/${id}`);

const payloadEntries = (point: QdrantStoredPoint): MetadataEntry[] =>
  Object.entries(point.payload ?? {}).filter(isMetadataEntry);

const fromPoint = (point: QdrantStoredPoint): string => {
  const stored = payloadEntries(point).find(([key]) => key === QDRANT_ID_KEY);
  return stored !== undefined && isString(stored[1])
    ? stored[1]
    : String(point.id);
};

const readMetadata = (point: QdrantStoredPoint): Metadata =>
  metadataFromEntries(payloadEntries(point), RESERVED_KEYS);

const readVector = (point: QdrantStoredPoint): number[] | undefined =>
  isNumberArray(point.vector) ? point.vector : undefined;

const toPayload = (
  namespace: string,
  record: VectorRecord,
  pointId: string
): Record<string, MetadataValue> => {
  const entries: MetadataEntry[] = Object.entries(record.metadata ?? {});
  if (pointId !== record.id) {
    entries.push([QDRANT_ID_KEY, record.id]);
  }
  if (namespace !== "") {
    entries.push([QDRANT_NAMESPACE_KEY, namespace]);
  }
  return Object.fromEntries(entries);
};

const namespaceCondition = (namespace: string): QdrantCondition =>
  namespace === ""
    ? {
        should: [
          { is_empty: { key: QDRANT_NAMESPACE_KEY } },
          { key: QDRANT_NAMESPACE_KEY, match: { value: "" } },
        ],
      }
    : { key: QDRANT_NAMESPACE_KEY, match: { value: namespace } };

export const scopeQdrantFilter = (
  namespace?: string,
  filter?: Filter
): QdrantFilter => {
  const scope = namespaceCondition(namespace ?? "");
  return {
    must: filter === undefined ? [scope] : [scope, compileQdrantFilter(filter)],
  };
};

interface HttpFailure {
  readonly status: number;
}

const isHttpFailure = (cause: unknown): cause is HttpFailure =>
  isObjectLike(cause) && "status" in cause && typeof cause.status === "number";

interface StatusError {
  readonly error: string;
}

const isStatusError = (value: unknown): value is StatusError =>
  isObjectLike(value) && "error" in value && typeof value.error === "string";

interface WithData {
  readonly data: object;
}

const hasData = (cause: unknown): cause is WithData =>
  isObjectLike(cause) && "data" in cause && isObjectLike(cause.data);

interface ApiFailure {
  readonly data: { readonly status: StatusError };
}

const isApiFailure = (cause: unknown): cause is ApiFailure =>
  hasData(cause) && "status" in cause.data && isStatusError(cause.data.status);

const failureMessage = (cause: unknown): string =>
  isApiFailure(cause) ? cause.data.status.error : errorMessage(cause);

const isConnectionFailure = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) {
    return false;
  }
  if (cause.name === "QdrantClientTimeoutError") {
    return true;
  }
  return cause.name === "TypeError" && cause.message === "fetch failed";
};

export const normalizeQdrantError = (
  cause: unknown,
  index: string
): VecstoreError => {
  if (isHttpFailure(cause)) {
    switch (cause.status) {
      case HTTP_NOT_FOUND: {
        return notFound(PROVIDER, index, cause);
      }
      case HTTP_CONFLICT: {
        return alreadyExists(PROVIDER, index, cause);
      }
      case HTTP_BAD_REQUEST:
      case HTTP_UNPROCESSABLE: {
        return invalidArgument(PROVIDER, failureMessage(cause), cause);
      }
      case HTTP_UNAUTHORIZED:
      case HTTP_FORBIDDEN: {
        return unauthorized(PROVIDER, cause);
      }
      default: {
        return providerError(PROVIDER, cause);
      }
    }
  }
  if (isConnectionFailure(cause)) {
    return connection(PROVIDER, cause);
  }
  return providerError(PROVIDER, cause);
};

const run = <T>(index: string, action: () => Promise<T>): VecResult<T> =>
  attempt((cause) => normalizeQdrantError(cause, index), action);

const createIndex = (
  client: QdrantClientLike,
  name: string,
  options: IndexOptions
): VectorIndex => {
  const namespace = options.namespace ?? "";
  return {
    delete: (selector: DeleteSelector) =>
      run(name, async () => {
        if ("ids" in selector) {
          await client.delete(name, {
            points: selector.ids.map((id) => toPointId(namespace, id)),
            wait: true,
          });
          return;
        }
        const filter = "filter" in selector ? selector.filter : undefined;
        await client.delete(name, {
          filter: scopeQdrantFilter(options.namespace, filter),
          wait: true,
        });
      }),

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(name, async () => {
        if (ids.length === 0) {
          return [];
        }
        const points = await client.retrieve(name, {
          ids: ids.map((id) => toPointId(namespace, id)),
          with_payload: true,
          with_vector: fetchOptions.includeVector ?? false,
        });
        const records = points.map((point): VectorRecord => ({
          id: fromPoint(point),
          metadata: readMetadata(point),
          vector: readVector(point) ?? [],
        }));
        return sortByIds(ids, records);
      }),

    name,

    namespace: options.namespace,

    query: (query: QueryOptions) =>
      run(name, async () => {
        const includeMetadata = query.includeMetadata ?? true;
        const response = await client.query(name, {
          filter: scopeQdrantFilter(options.namespace, query.filter),
          limit: query.topK,
          query: [...query.vector],
          with_payload: true,
          with_vector: query.includeVector ?? false,
        });
        return response.points.map((point): ScoredRecord => ({
          id: fromPoint(point),
          metadata: includeMetadata ? readMetadata(point) : undefined,
          score: point.score,
          vector: readVector(point),
        }));
      }),

    upsert: (records) =>
      run(name, async () => {
        if (records.length === 0) {
          return;
        }
        const points = records.map((record): QdrantPoint => {
          const id = toPointId(namespace, record.id);
          return {
            id,
            payload: toPayload(namespace, record, id),
            vector: [...record.vector],
          };
        });
        await client.upsert(name, { points, wait: true });
      }),
  };
};

export const createQdrantStore = <Client extends QdrantClientLike>(
  options: QdrantStoreOptions<Client>
): VectorStore<Client> => {
  const { client } = options;
  return {
    createIndex: (spec: IndexSpec) =>
      run(spec.name, async () => {
        await client.createCollection(spec.name, {
          vectors: {
            distance: DISTANCES[spec.metric ?? "cosine"],
            size: spec.dimension,
          },
        });
        await client.createPayloadIndex(spec.name, {
          field_name: QDRANT_NAMESPACE_KEY,
          field_schema: { is_tenant: true, type: "keyword" },
          wait: true,
        });
      }),

    deleteIndex: (name) =>
      run(name, async () => {
        await client.deleteCollection(name);
      }),

    index: (name, indexOptions = {}) => createIndex(client, name, indexOptions),

    listIndexes: () =>
      run("", async () => {
        const response = await client.getCollections();
        return response.collections.map((collection) => collection.name);
      }),

    provider: PROVIDER,

    raw: client,
  };
};
