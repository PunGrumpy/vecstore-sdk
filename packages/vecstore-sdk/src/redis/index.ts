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
import {
  compileRedisFilter,
  REDIS_FIELD_PATTERN,
  REDIS_RESERVED_FIELDS,
  redisTagClause,
} from "../filter/redis";
import type {
  RedisFieldType,
  RedisFilterProblem,
  RedisMetadataField,
} from "../filter/redis";
import { attempt } from "../internal/attempt";
import { sortByIds } from "../internal/collections";
import {
  isNumber,
  isNumberArray,
  isObjectLike,
  isString,
} from "../internal/guards";
import { isMetadataEntry, metadataFromEntries } from "../internal/metadata";
import { err, ok } from "../result";
import type { Result } from "../result";
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
  compileRedisFilter,
  escapeRedisTag,
  REDIS_FIELD_PATTERN,
  REDIS_RESERVED_FIELDS,
  redisTagClause,
  type RedisFieldType,
  type RedisFilterProblem,
  type RedisFilterResult,
  type RedisMetadataField,
} from "../filter/redis";

export type RedisVectorAlgorithm = "FLAT" | "HNSW";

export type RedisDistanceMetric = "L2" | "IP" | "COSINE";

export interface RedisTagFieldDefinition {
  readonly type: "TAG";
  readonly AS: string;
  readonly CASESENSITIVE: true;
  readonly INDEXEMPTY: true;
  readonly INDEXMISSING?: true;
}

export interface RedisNumericFieldDefinition {
  readonly type: "NUMERIC";
  readonly AS: string;
  readonly INDEXMISSING: true;
}

export interface RedisVectorFieldDefinition {
  readonly type: "VECTOR";
  readonly AS: string;
  readonly ALGORITHM: RedisVectorAlgorithm;
  readonly TYPE: "FLOAT32";
  readonly DIM: number;
  readonly DISTANCE_METRIC: RedisDistanceMetric;
}

export type RedisFieldDefinition =
  | RedisTagFieldDefinition
  | RedisNumericFieldDefinition
  | RedisVectorFieldDefinition;

export interface RedisSchema {
  readonly [path: string]: RedisFieldDefinition;
}

export interface RedisCreateOptions {
  readonly ON: "JSON";
  readonly PREFIX: string;
}

export interface RedisSearchDocument {
  readonly id: string;
  readonly value: object;
}

export interface RedisSearchReply {
  readonly total: number;
  readonly documents: readonly RedisSearchDocument[];
}

export interface RedisSearchOptions {
  readonly RETURN?: string[];
  readonly SORTBY?: { readonly BY: string; readonly DIRECTION?: "ASC" };
  readonly LIMIT?: { readonly from: number; readonly size: number };
  readonly PARAMS?: Record<string, string | number | Buffer>;
  readonly DIALECT?: number;
}

export type RedisJsonValue =
  | string
  | number
  | boolean
  | null
  | Date
  | RedisJsonValue[]
  | { [key: string]: RedisJsonValue };

export interface RedisClientLike {
  readonly ft: {
    readonly create: (
      index: string,
      schema: RedisSchema,
      options?: RedisCreateOptions
    ) => Promise<string>;
    readonly search: (
      index: string,
      query: string,
      options?: RedisSearchOptions
    ) => Promise<RedisSearchReply>;
    readonly dropIndex: (
      index: string,
      options?: { readonly DD?: true }
    ) => Promise<string | number>;
    readonly _list: () => Promise<Iterable<string>>;
  };
  readonly json: {
    readonly set: (
      key: string,
      path: string,
      json: RedisJsonValue
    ) => Promise<string | null>;
    readonly mGet: (keys: string[], path: string) => Promise<RedisJsonValue[]>;
  };
  readonly unlink: (keys: string[]) => Promise<number>;
}

export interface RedisStoreOptions<Client> {
  readonly client: Client;
  readonly metadataFields?: readonly RedisMetadataField[];
  readonly keyPrefix?: string;
  readonly algorithm?: RedisVectorAlgorithm;
}

export const REDIS_VECTOR_FIELD = "vector";
export const REDIS_NAMESPACE_FIELD = "namespace";
export const REDIS_DISTANCE_FIELD = "vector_distance";

const PROVIDER = "redis";
const DEFAULT_KEY_PREFIX = "vecstore:";
const DEFAULT_NAMESPACE = "";
const DEFAULT_ALGORITHM = "FLAT";
const ROOT_PATH = "$";
const VECTOR_PATH = "$.vector";
const NAMESPACE_PATH = "$.namespace";
const METADATA_PATH = "$.metadata";
const METADATA_KEY = "metadata";
const VECTOR_KEY = "vector";
const BLOB_PARAM = "BLOB";
const DIALECT = 2;
const DELETE_PAGE = 500;

const METRICS: Record<Metric, RedisDistanceMetric> = {
  cosine: "COSINE",
  dot: "IP",
  euclidean: "L2",
};

const NOT_FOUND_PATTERN = /unknown index name|no such index/iu;
const ALREADY_EXISTS_PATTERN = /index already exists/iu;
const UNAUTHORIZED_PATTERN = /noauth|wrongpass|noperm|unauthenticated/iu;
const UNKNOWN_COMMAND_PATTERN = /unknown command/iu;
const INVALID_ARGUMENT_PATTERN =
  /syntax error|invalid|bad|wrong number of arguments|not a number|dimension|expected/iu;
const SOCKET_TIMEOUT_PREFIX = "Socket timeout";

const CONNECTION_MESSAGES: ReadonlySet<string> = new Set([
  "The client is closed",
  "The client is offline",
  "Socket closed unexpectedly",
  "Connection timeout",
  "Disconnects client",
  "All the root nodes are unavailable",
]);

const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EPIPE",
]);

const MODULES_MESSAGE =
  "This Redis server has no query engine or no JSON support. Run Redis 8 or later, Redis Stack 7.4 or later, or Redis Cloud with both of them enabled.";

const hasCode = (cause: unknown): cause is Error & { readonly code: string } =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string";

const isConnectionFailure = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) {
    return false;
  }
  if (hasCode(cause) && CONNECTION_CODES.has(cause.code)) {
    return true;
  }
  return (
    CONNECTION_MESSAGES.has(cause.message) ||
    cause.message.startsWith(SOCKET_TIMEOUT_PREFIX)
  );
};

export const normalizeRedisError = (
  cause: unknown,
  index: string
): VecstoreError => {
  if (isConnectionFailure(cause)) {
    return connection(PROVIDER, cause);
  }
  const message = errorMessage(cause);
  if (UNKNOWN_COMMAND_PATTERN.test(message)) {
    return unsupported(PROVIDER, "queryEngine", MODULES_MESSAGE);
  }
  if (ALREADY_EXISTS_PATTERN.test(message)) {
    return alreadyExists(PROVIDER, index, cause);
  }
  if (NOT_FOUND_PATTERN.test(message)) {
    return notFound(PROVIDER, index, cause);
  }
  if (UNAUTHORIZED_PATTERN.test(message)) {
    return unauthorized(PROVIDER, cause);
  }
  if (INVALID_ARGUMENT_PATTERN.test(message)) {
    return invalidArgument(PROVIDER, message, cause);
  }
  return providerError(PROVIDER, cause);
};

const run = <T>(index: string, action: () => Promise<T>): VecResult<T> =>
  attempt((cause) => normalizeRedisError(cause, index), action);

const toVecstoreError = (problem: RedisFilterProblem): VecstoreError =>
  invalidArgument(PROVIDER, problem.message);

const redisFieldError = (field: RedisMetadataField): string | undefined => {
  if (REDIS_RESERVED_FIELDS.has(field.field)) {
    return `The Redis adapter keeps "${field.field}" for itself. Rename the metadata field.`;
  }
  if (!REDIS_FIELD_PATTERN.test(field.field)) {
    return `Redis cannot name a field "${field.field}". A field name must match ${REDIS_FIELD_PATTERN.source}.`;
  }
  return undefined;
};

const fieldDefinition = (field: RedisMetadataField): RedisFieldDefinition =>
  field.type === "numeric"
    ? { AS: field.field, INDEXMISSING: true, type: "NUMERIC" }
    : {
        AS: field.field,
        CASESENSITIVE: true,
        INDEXEMPTY: true,
        INDEXMISSING: true,
        type: "TAG",
      };

export const redisSchema = (
  spec: IndexSpec,
  fields: readonly RedisMetadataField[],
  algorithm: RedisVectorAlgorithm
): RedisSchema => {
  const entries: [string, RedisFieldDefinition][] = [
    [
      VECTOR_PATH,
      {
        ALGORITHM: algorithm,
        AS: REDIS_VECTOR_FIELD,
        DIM: spec.dimension,
        DISTANCE_METRIC: METRICS[spec.metric ?? "cosine"],
        TYPE: "FLOAT32",
        type: "VECTOR",
      },
    ],
    [
      NAMESPACE_PATH,
      {
        AS: REDIS_NAMESPACE_FIELD,
        CASESENSITIVE: true,
        INDEXEMPTY: true,
        type: "TAG",
      },
    ],
  ];
  for (const field of fields) {
    entries.push([`${METADATA_PATH}.${field.field}`, fieldDefinition(field)]);
  }
  return Object.fromEntries(entries);
};

export const scopeRedisFilter = (
  namespace: string,
  fields: readonly RedisMetadataField[],
  filter?: Filter
): Result<string, RedisFilterProblem> => {
  const scope = redisTagClause(REDIS_NAMESPACE_FIELD, namespace);
  if (filter === undefined) {
    return ok(scope);
  }
  const compiled = compileRedisFilter(filter, fields);
  return compiled.ok ? ok(`${scope} ${compiled.value}`) : compiled;
};

export const redisKeyPrefix = (
  keyPrefix: string,
  index: string,
  namespace: string
): string => `${keyPrefix}${index}:${encodeURIComponent(namespace)}:`;

const toBlob = (vector: readonly number[]): Buffer => {
  const floats = Float32Array.from(vector);
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength);
};

const toDocument = (
  namespace: string,
  record: VectorRecord
): RedisJsonValue => ({
  metadata: Object.fromEntries(Object.entries(record.metadata ?? {})),
  namespace,
  vector: [...record.vector],
});

const typeName = (value: MetadataValue): string => {
  if (isNumber(value)) {
    return "a number";
  }
  return isString(value) ? "a string" : "a boolean or a list";
};

const holdsWrongType = (
  type: RedisFieldType,
  value: MetadataValue
): boolean => {
  const numeric = isNumber(value);
  return type === "numeric" ? !numeric : numeric;
};

const redisMetadataError = (
  record: VectorRecord,
  fields: readonly RedisMetadataField[]
): string | undefined => {
  const metadata = Object.entries(record.metadata ?? {});
  for (const field of fields) {
    const entry = metadata.find(([key]) => key === field.field);
    if (entry !== undefined && holdsWrongType(field.type, entry[1])) {
      return `Redis leaves a whole document out of the index when a field holds a value its schema has no room for. Record "${record.id}" carries ${typeName(entry[1])} in "${field.field}", which the schema declares as ${field.type}.`;
    }
  }
  return undefined;
};

const jsonEntries = (value: RedisJsonValue): [string, RedisJsonValue][] => {
  if (Array.isArray(value)) {
    const [first] = value;
    return first === undefined ? [] : jsonEntries(first);
  }
  return isObjectLike(value) && !(value instanceof Date)
    ? Object.entries(value)
    : [];
};

const jsonField = (
  entries: readonly [string, RedisJsonValue][],
  key: string
): RedisJsonValue => entries.find(([name]) => name === key)?.[1] ?? null;

const jsonVector = (value: RedisJsonValue): number[] => {
  if (isNumberArray(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    const [first] = value;
    return isNumberArray(first) ? first : [];
  }
  return [];
};

const jsonMetadata = (value: RedisJsonValue): Metadata =>
  metadataFromEntries(jsonEntries(value).filter(isMetadataEntry));

const parseJsonText = (source: string | undefined): RedisJsonValue => {
  if (source === undefined) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
};

const projection = (
  document: RedisSearchDocument,
  field: string
): string | undefined => {
  const entry = Object.entries(document.value).find(([key]) => key === field);
  const value: unknown = entry?.[1];
  return isString(value) ? value : undefined;
};

const distanceOf = (document: RedisSearchDocument): number => {
  const entry = Object.entries(document.value).find(
    ([key]) => key === REDIS_DISTANCE_FIELD
  );
  const value: unknown = entry?.[1];
  if (isNumber(value)) {
    return value;
  }
  const parsed = isString(value) ? Number(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

const knnQuery = (prefilter: string, topK: number): string =>
  `(${prefilter})=>[KNN ${topK} @${REDIS_VECTOR_FIELD} $${BLOB_PARAM} AS ${REDIS_DISTANCE_FIELD}]`;

const queryReturn = (
  includeMetadata: boolean,
  includeVector: boolean
): string[] => {
  const fields = [REDIS_DISTANCE_FIELD];
  if (includeMetadata) {
    fields.push(METADATA_PATH);
  }
  if (includeVector) {
    fields.push(VECTOR_PATH);
  }
  return fields;
};

const toScoredRecord = (
  document: RedisSearchDocument,
  prefix: string,
  includeMetadata: boolean,
  includeVector: boolean
): ScoredRecord | undefined => {
  if (!document.id.startsWith(prefix)) {
    return undefined;
  }
  const metadata = includeMetadata
    ? jsonMetadata(parseJsonText(projection(document, METADATA_PATH)))
    : undefined;
  const vector = includeVector
    ? jsonVector(parseJsonText(projection(document, VECTOR_PATH)))
    : undefined;
  return {
    id: document.id.slice(prefix.length),
    metadata,
    score: distanceOf(document),
    vector,
  };
};

const toVectorRecord = (
  id: string,
  stored: RedisJsonValue,
  includeVector: boolean
): VectorRecord => {
  const entries = jsonEntries(stored);
  return {
    id,
    metadata: jsonMetadata(jsonField(entries, METADATA_KEY)),
    vector: includeVector ? jsonVector(jsonField(entries, VECTOR_KEY)) : [],
  };
};

interface IndexContext {
  readonly client: RedisClientLike;
  readonly fields: readonly RedisMetadataField[];
  readonly name: string;
  readonly namespace: string;
  readonly prefix: string;
}

const deletePage = async (
  context: IndexContext,
  prefilter: string
): Promise<number> => {
  const page = await context.client.ft.search(context.name, prefilter, {
    DIALECT,
    LIMIT: { from: 0, size: DELETE_PAGE },
    RETURN: [],
  });
  const keys = page.documents.map((document) => document.id);
  if (keys.length > 0) {
    await context.client.unlink(keys);
  }
  return keys.length;
};

const deleteMatches = async (
  context: IndexContext,
  prefilter: string
): Promise<void> => {
  const removed = await deletePage(context, prefilter);
  if (removed === DELETE_PAGE) {
    await deleteMatches(context, prefilter);
  }
};

const deleteByFilter = (
  context: IndexContext,
  filter?: Filter
): VecResult<void> => {
  const prefilter = scopeRedisFilter(context.namespace, context.fields, filter);
  if (!prefilter.ok) {
    return Promise.resolve(err(toVecstoreError(prefilter.error)));
  }
  return run(context.name, () => deleteMatches(context, prefilter.value));
};

const queryIndex = async (
  context: IndexContext,
  query: QueryOptions,
  prefilter: string
): Promise<ScoredRecord[]> => {
  const includeMetadata = query.includeMetadata ?? true;
  const includeVector = query.includeVector ?? false;
  const reply = await context.client.ft.search(
    context.name,
    knnQuery(prefilter, query.topK),
    {
      DIALECT,
      LIMIT: { from: 0, size: query.topK },
      PARAMS: { [BLOB_PARAM]: toBlob(query.vector) },
      RETURN: queryReturn(includeMetadata, includeVector),
      SORTBY: { BY: REDIS_DISTANCE_FIELD, DIRECTION: "ASC" },
    }
  );
  const records: ScoredRecord[] = [];
  for (const document of reply.documents) {
    const record = toScoredRecord(
      document,
      context.prefix,
      includeMetadata,
      includeVector
    );
    if (record !== undefined) {
      records.push(record);
    }
  }
  return records;
};

const fetchRecords = async (
  context: IndexContext,
  ids: readonly string[],
  includeVector: boolean
): Promise<VectorRecord[]> => {
  const keys = ids.map((id) => `${context.prefix}${id}`);
  const stored = await context.client.json.mGet(keys, ROOT_PATH);
  const records: VectorRecord[] = [];
  for (const [position, id] of ids.entries()) {
    const value = stored[position];
    if (value !== null && value !== undefined) {
      records.push(toVectorRecord(id, value, includeVector));
    }
  }
  return sortByIds(ids, records);
};

const upsertRecords = async (
  context: IndexContext,
  records: readonly VectorRecord[]
): Promise<void> => {
  await Promise.all(
    records.map((record) =>
      context.client.json.set(
        `${context.prefix}${record.id}`,
        ROOT_PATH,
        toDocument(context.namespace, record)
      )
    )
  );
};

const metadataError = (
  records: readonly VectorRecord[],
  fields: readonly RedisMetadataField[]
): string | undefined => {
  for (const record of records) {
    const message = redisMetadataError(record, fields);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
};

const createIndex = (
  client: RedisClientLike,
  fields: readonly RedisMetadataField[],
  keyPrefix: string,
  name: string,
  options: IndexOptions
): VectorIndex => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const context: IndexContext = {
    client,
    fields,
    name,
    namespace,
    prefix: redisKeyPrefix(keyPrefix, name, namespace),
  };
  return {
    delete: (selector: DeleteSelector) => {
      if ("ids" in selector) {
        return run(name, async () => {
          await client.unlink(
            selector.ids.map((id) => `${context.prefix}${id}`)
          );
        });
      }
      return deleteByFilter(
        context,
        "filter" in selector ? selector.filter : undefined
      );
    },

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(name, async () => {
        if (ids.length === 0) {
          return [];
        }
        return await fetchRecords(
          context,
          ids,
          fetchOptions.includeVector ?? false
        );
      }),

    name,

    namespace: options.namespace,

    query: (query: QueryOptions) => {
      const prefilter = scopeRedisFilter(namespace, fields, query.filter);
      if (!prefilter.ok) {
        return Promise.resolve(err(toVecstoreError(prefilter.error)));
      }
      return run(name, () => queryIndex(context, query, prefilter.value));
    },

    upsert: (records) => {
      const message = metadataError(records, fields);
      if (message !== undefined) {
        return Promise.resolve(err(invalidArgument(PROVIDER, message)));
      }
      return run(name, async () => {
        if (records.length === 0) {
          return;
        }
        await upsertRecords(context, records);
      });
    },
  };
};

export const createRedisStore = <Client extends RedisClientLike>(
  options: RedisStoreOptions<Client>
): VectorStore<Client> => {
  const { client } = options;
  const fields = options.metadataFields ?? [];
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const algorithm = options.algorithm ?? DEFAULT_ALGORITHM;
  return {
    createIndex: (spec: IndexSpec) => {
      for (const field of fields) {
        const message = redisFieldError(field);
        if (message !== undefined) {
          return Promise.resolve(err(invalidArgument(PROVIDER, message)));
        }
      }
      return run(spec.name, async () => {
        await client.ft.create(
          spec.name,
          redisSchema(spec, fields, algorithm),
          {
            ON: "JSON",
            PREFIX: `${keyPrefix}${spec.name}:`,
          }
        );
      });
    },

    deleteIndex: (name) =>
      run(name, async () => {
        await client.ft.dropIndex(name, { DD: true });
      }),

    index: (name, indexOptions = {}) =>
      createIndex(client, fields, keyPrefix, name, indexOptions),

    listIndexes: () =>
      run("", async () => {
        const names: string[] = [];
        for (const name of await client.ft._list()) {
          if (isString(name)) {
            names.push(name);
          }
        }
        return names;
      }),

    provider: PROVIDER,

    raw: client,
  };
};
