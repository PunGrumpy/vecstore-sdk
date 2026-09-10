import type Cloudflare from "cloudflare";

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
import type { Filter } from "../filter/ast";
import { compileVectorizeFilter } from "../filter/vectorize";
import type {
  VectorizeFilter,
  VectorizeFilterProblem,
} from "../filter/vectorize";
import { attempt } from "../internal/attempt";
import { chunk, sortByIds } from "../internal/collections";
import { isNumberArray, isObjectLike, isString } from "../internal/guards";
import { isMetadataEntry, metadataFromEntries } from "../internal/metadata";
import type { MetadataEntry } from "../internal/metadata";
import { deterministicUuid } from "../internal/uuid";
import { err } from "../result";
import type { Result } from "../result";
import type {
  DeleteSelector,
  FetchOptions,
  IndexOptions,
  IndexSpec,
  Metadata,
  Metric,
  QueryOptions,
  ScoredRecord,
  VecResult,
  VectorIndex,
  VectorRecord,
  VectorStore,
} from "../types";

export {
  compileVectorizeFilter,
  type VectorizeCollection,
  type VectorizeCollectionOperator,
  type VectorizeComparison,
  type VectorizeComparisonOperator,
  type VectorizeCondition,
  type VectorizeFilter,
  type VectorizeFilterProblem,
  type VectorizeFilterResult,
  type VectorizeInvalidFilter,
  type VectorizeUnsupportedFilter,
} from "../filter/vectorize";

export type VectorizeClient = Pick<Cloudflare, "vectorize">;

export type VectorizeIndexes = VectorizeClient["vectorize"]["indexes"];

export type VectorizeQueryParams = Parameters<VectorizeIndexes["query"]>[1] & {
  readonly namespace?: string;
};

export type VectorizeMetric = "cosine" | "euclidean" | "dot-product";

export type VectorizeMetadataIndexType = "string" | "number" | "boolean";

export interface VectorizeMetadataIndexSpec {
  readonly property: string;
  readonly type: VectorizeMetadataIndexType;
}

export interface VectorizeStoreOptions<Client> {
  readonly client: Client;
  readonly accountId: string;
  readonly metadataIndexes?: readonly VectorizeMetadataIndexSpec[];
}

export interface VectorizeStoredVector {
  readonly id: string;
  readonly namespace?: string | null;
  readonly values?: object | null;
  readonly metadata?: object | null;
}

export interface VectorizeScoredVector extends VectorizeStoredVector {
  readonly score: number;
}

export const VECTORIZE_ID_KEY = "_id";

const RESERVED_KEYS: ReadonlySet<string> = new Set([VECTORIZE_ID_KEY]);

const PROVIDER = "vectorize";
const DEFAULT_NAMESPACE = "";
const ID_NAMESPACE = "vecstore-sdk/vectorize/vector-id";
const MAX_ID_BYTES = 64;
const UPSERT_BATCH = 1000;
const ID_BATCH = 1000;
const NDJSON_NAME = "vectors.ndjson";
const NDJSON_TYPE = "application/x-ndjson";
const UNPARSABLE_BEHAVIOR = "error";

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

const NOT_FOUND_PATTERN = /not found|does not exist|no such/iu;
const ALREADY_EXISTS_PATTERN = /already exists|duplicate/iu;
const CONNECTION_PATTERN = /connection error|timed out|fetch failed/iu;

const METRICS: Record<Metric, VectorizeMetric> = {
  cosine: "cosine",
  dot: "dot-product",
  euclidean: "euclidean",
};

const DELETE_BY_FILTER_MESSAGE =
  "Vectorize deletes vectors by id only. Query for the ids you want to remove, then delete those.";

const DELETE_ALL_MESSAGE =
  "Vectorize has no call that empties a namespace. Query for the ids you want to remove and delete those, or delete the whole index.";

const encoder = new TextEncoder();

interface HttpFailure {
  readonly status: number;
}

const isHttpFailure = (cause: unknown): cause is HttpFailure =>
  isObjectLike(cause) && "status" in cause && typeof cause.status === "number";

const refineBadRequest = (
  cause: unknown,
  index: string,
  message: string
): VecstoreError => {
  if (ALREADY_EXISTS_PATTERN.test(message)) {
    return alreadyExists(PROVIDER, index, cause);
  }
  if (NOT_FOUND_PATTERN.test(message)) {
    return notFound(PROVIDER, index, cause);
  }
  return invalidArgument(PROVIDER, message, cause);
};

export const normalizeVectorizeError = (
  cause: unknown,
  index: string
): VecstoreError => {
  const message = errorMessage(cause);
  if (!isHttpFailure(cause)) {
    return CONNECTION_PATTERN.test(message)
      ? connection(PROVIDER, cause)
      : providerError(PROVIDER, cause);
  }
  const { status } = cause;
  if (status === HTTP_NOT_FOUND) {
    return notFound(PROVIDER, index, cause);
  }
  if (status === HTTP_CONFLICT) {
    return alreadyExists(PROVIDER, index, cause);
  }
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return unauthorized(PROVIDER, cause);
  }
  if (status === HTTP_BAD_REQUEST || status === HTTP_UNPROCESSABLE) {
    return refineBadRequest(cause, index, message);
  }
  return providerError(PROVIDER, cause);
};

const run = <T>(index: string, action: () => Promise<T>): VecResult<T> =>
  attempt((cause) => normalizeVectorizeError(cause, index), action);

const toVecstoreError = (problem: VectorizeFilterProblem): VecstoreError =>
  problem.kind === "unsupported"
    ? unsupported(PROVIDER, problem.feature, problem.message)
    : invalidArgument(PROVIDER, problem.message);

const compileFilter = (
  filter: Filter
): Result<VectorizeFilter, VecstoreError> => {
  const compiled = compileVectorizeFilter(filter);
  return compiled.ok ? compiled : err(toVecstoreError(compiled.error));
};

const fitsNativeId = (id: string): boolean =>
  encoder.encode(id).length <= MAX_ID_BYTES;

export const toVectorizeId = (namespace: string, id: string): string =>
  namespace === DEFAULT_NAMESPACE && fitsNativeId(id)
    ? id
    : deterministicUuid(ID_NAMESPACE, `${namespace}/${id.length}/${id}`);

const isStoredVector = (value: unknown): value is VectorizeStoredVector =>
  isObjectLike(value) && "id" in value && isString(value.id);

const isScoredVector = (value: unknown): value is VectorizeScoredVector =>
  isStoredVector(value) && "score" in value && typeof value.score === "number";

const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

const metadataEntries = (record: VectorizeStoredVector): MetadataEntry[] =>
  Object.entries(record.metadata ?? {}).filter(isMetadataEntry);

const readId = (record: VectorizeStoredVector): string => {
  const stored = metadataEntries(record).find(
    ([key]) => key === VECTORIZE_ID_KEY
  );
  return stored !== undefined && isString(stored[1]) ? stored[1] : record.id;
};

const readMetadata = (record: VectorizeStoredVector): Metadata =>
  metadataFromEntries(metadataEntries(record), RESERVED_KEYS);

const readVector = (record: VectorizeStoredVector): number[] =>
  isNumberArray(record.values) ? record.values : [];

const belongsToNamespace = (
  namespace: string,
  record: VectorizeStoredVector
): boolean => {
  const reported = isString(record.namespace)
    ? record.namespace
    : DEFAULT_NAMESPACE;
  return reported === DEFAULT_NAMESPACE || reported === namespace;
};

const nativeNamespace = (namespace: string): string | undefined =>
  namespace === DEFAULT_NAMESPACE ? undefined : namespace;

const toLine = (namespace: string, record: VectorRecord): string => {
  const id = toVectorizeId(namespace, record.id);
  const entries: MetadataEntry[] = Object.entries(record.metadata ?? {});
  if (id !== record.id) {
    entries.push([VECTORIZE_ID_KEY, record.id]);
  }
  return JSON.stringify({
    id,
    metadata: Object.fromEntries(entries),
    namespace: nativeNamespace(namespace),
    values: [...record.vector],
  });
};

const toNdjson = (lines: readonly string[]): File =>
  new File([lines.join("\n")], NDJSON_NAME, { type: NDJSON_TYPE });

const createIndex = (
  indexes: VectorizeIndexes,
  accountId: string,
  name: string,
  options: IndexOptions
): VectorIndex => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  return {
    delete: (selector: DeleteSelector): VecResult<void> => {
      if ("ids" in selector) {
        return run(name, async () => {
          const stored = selector.ids.map((id) => toVectorizeId(namespace, id));
          await Promise.all(
            chunk(stored, ID_BATCH).map((ids) =>
              indexes.deleteByIDs(name, { account_id: accountId, ids })
            )
          );
        });
      }
      if ("filter" in selector) {
        return Promise.resolve(
          err(unsupported(PROVIDER, "deleteByFilter", DELETE_BY_FILTER_MESSAGE))
        );
      }
      return Promise.resolve(
        err(unsupported(PROVIDER, "deleteAll", DELETE_ALL_MESSAGE))
      );
    },

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(name, async () => {
        if (ids.length === 0) {
          return [];
        }
        const includeVector = fetchOptions.includeVector ?? false;
        const stored = ids.map((id) => toVectorizeId(namespace, id));
        const responses = await Promise.all(
          chunk(stored, ID_BATCH).map((batch) =>
            indexes.getByIDs(name, { account_id: accountId, ids: batch })
          )
        );
        const records: VectorRecord[] = [];
        for (const response of responses) {
          for (const found of isUnknownArray(response) ? response : []) {
            if (isStoredVector(found) && belongsToNamespace(namespace, found)) {
              records.push({
                id: readId(found),
                metadata: readMetadata(found),
                vector: includeVector ? readVector(found) : [],
              });
            }
          }
        }
        return sortByIds(ids, records);
      }),

    name,

    namespace: options.namespace,

    query: (query: QueryOptions): VecResult<ScoredRecord[]> => {
      const compiled =
        query.filter === undefined ? undefined : compileFilter(query.filter);
      if (compiled?.ok === false) {
        return Promise.resolve(compiled);
      }
      const params: VectorizeQueryParams = {
        account_id: accountId,
        filter: compiled?.ok === true ? compiled.value : undefined,
        namespace: nativeNamespace(namespace),
        returnMetadata: "all",
        returnValues: query.includeVector ?? false,
        topK: query.topK,
        vector: [...query.vector],
      };
      return run(name, async () => {
        const includeMetadata = query.includeMetadata ?? true;
        const includeVector = query.includeVector === true;
        const response = await indexes.query(name, params);
        const records: ScoredRecord[] = [];
        for (const match of response?.matches ?? []) {
          if (isScoredVector(match)) {
            records.push({
              id: readId(match),
              metadata: includeMetadata ? readMetadata(match) : undefined,
              score: match.score,
              vector: includeVector ? readVector(match) : undefined,
            });
          }
        }
        return records;
      });
    },

    upsert: (records) =>
      run(name, async () => {
        if (records.length === 0) {
          return;
        }
        const lines = records.map((record) => toLine(namespace, record));
        await Promise.all(
          chunk(lines, UPSERT_BATCH).map((batch) =>
            indexes.upsert(name, {
              account_id: accountId,
              body: toNdjson(batch),
              "unparsable-behavior": UNPARSABLE_BEHAVIOR,
            })
          )
        );
      }),
  };
};

export const createVectorizeStore = <Client extends VectorizeClient>(
  options: VectorizeStoreOptions<Client>
): VectorStore<Client> => {
  const { accountId, client } = options;
  const { indexes } = client.vectorize;
  const metadataIndexes = options.metadataIndexes ?? [];
  return {
    createIndex: (spec: IndexSpec) =>
      run(spec.name, async () => {
        await indexes.create({
          account_id: accountId,
          config: {
            dimensions: spec.dimension,
            metric: METRICS[spec.metric ?? "cosine"],
          },
          name: spec.name,
        });
        await Promise.all(
          metadataIndexes.map((metadataIndex) =>
            indexes.metadataIndex.create(spec.name, {
              account_id: accountId,
              indexType: metadataIndex.type,
              propertyName: metadataIndex.property,
            })
          )
        );
      }),

    deleteIndex: (name) =>
      run(name, async () => {
        await indexes.delete(name, { account_id: accountId });
      }),

    index: (name, indexOptions = {}) =>
      createIndex(indexes, accountId, name, indexOptions),

    listIndexes: () =>
      run("", async () => {
        const page = await indexes.list({ account_id: accountId });
        const names: string[] = [];
        for (const index of page.result) {
          if (isString(index.name)) {
            names.push(index.name);
          }
        }
        return names;
      }),

    provider: PROVIDER,

    raw: client,
  };
};
