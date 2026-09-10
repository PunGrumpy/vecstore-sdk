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
import { and, eq, exists, not, or } from "../filter/ast";
import type { Filter } from "../filter/ast";
import { compileUpstashFilter, isUpstashFilterError } from "../filter/upstash";
import { attempt } from "../internal/attempt";
import { chunk, sortByIds } from "../internal/collections";
import { isString } from "../internal/guards";
import { isMetadataEntry, metadataFromEntries } from "../internal/metadata";
import type { MetadataEntry } from "../internal/metadata";
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

export { compileUpstashFilter, isUpstashFilterError } from "../filter/upstash";

export type UpstashSimilarity = "COSINE" | "EUCLIDEAN" | "DOT_PRODUCT";

export type UpstashNamespaceMode = "metadata" | "native";

export interface UpstashRecordLike {
  readonly id: string;
  readonly vector: number[];
  readonly metadata?: Record<string, MetadataValue>;
}

export interface UpstashStoredRecord {
  readonly id: string;
  readonly vector?: number[];
  readonly metadata?: object | null;
}

export interface UpstashScoredRecord {
  readonly id: string | number;
  readonly score: number;
  readonly vector?: number[];
  readonly metadata?: object | null;
}

export interface UpstashDeleteResult {
  readonly deleted: number;
}

export interface UpstashInfo {
  readonly dimension: number;
  readonly similarityFunction: UpstashSimilarity;
}

export interface UpstashNamespaceOptions {
  readonly namespace?: string;
}

export interface UpstashIndexLike {
  readonly upsert: (
    records: UpstashRecordLike[],
    options?: UpstashNamespaceOptions
  ) => Promise<string>;
  readonly query: (
    args: {
      vector: number[];
      topK: number;
      filter?: string;
      includeMetadata?: boolean;
      includeVectors?: boolean;
    },
    options?: UpstashNamespaceOptions
  ) => Promise<UpstashScoredRecord[]>;
  readonly fetch: (
    ids: string[],
    options?: UpstashNamespaceOptions & {
      includeMetadata?: boolean;
      includeVectors?: boolean;
    }
  ) => Promise<(UpstashStoredRecord | null)[]>;
  readonly delete: (
    args: { ids: string[] } | { filter: string },
    options?: UpstashNamespaceOptions
  ) => Promise<UpstashDeleteResult>;
  readonly reset: (options?: UpstashNamespaceOptions) => Promise<string>;
  readonly info: () => Promise<UpstashInfo>;
  readonly listNamespaces: () => Promise<string[]>;
  readonly deleteNamespace: (namespace: string) => Promise<string>;
}

export interface UpstashStoreOptions<Client> {
  readonly client: Client;
  readonly namespaceMode?: UpstashNamespaceMode;
}

export const UPSTASH_ID_KEY = "_id";
export const UPSTASH_NAMESPACE_KEY = "_namespace";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  UPSTASH_ID_KEY,
  UPSTASH_NAMESPACE_KEY,
]);

const PROVIDER = "upstash";
const DEFAULT_NAMESPACE = "";
const NAMESPACE_SEPARATOR = "~";
const UPSERT_BATCH = 100;
const ID_BATCH = 1000;

const SIMILARITIES: Record<Metric, UpstashSimilarity> = {
  cosine: "COSINE",
  dot: "DOT_PRODUCT",
  euclidean: "EUCLIDEAN",
};

const NOT_FOUND_PATTERN = /not found|does not exist|no such/iu;
const ALREADY_EXISTS_PATTERN = /already exists/iu;
const UNAUTHORIZED_PATTERN = /unauthorized|forbidden|invalid token/iu;
const INVALID_ARGUMENT_PATTERN =
  /dimension|invalid|malformed|parse|must be|too large|exceed/iu;

const ARGUMENT_ERROR = "UpstashArgumentError";
const CONFLICT_ERROR = "UpstashConflictError";
const MISSING_ERROR = "UpstashMissingError";

type AdapterErrorName =
  | typeof ARGUMENT_ERROR
  | typeof CONFLICT_ERROR
  | typeof MISSING_ERROR;

const taggedError = (name: AdapterErrorName, message: string): Error =>
  Object.assign(new Error(message), { name });

const isConnectionFailure = (cause: unknown): boolean => {
  if (!(cause instanceof Error) || cause.name === "UpstashError") {
    return false;
  }
  return (
    cause.message === "fetch failed" ||
    cause.message === "Exhausted all retries" ||
    cause.name === "AbortError"
  );
};

export const normalizeUpstashError = (
  cause: unknown,
  index: string
): VecstoreError => {
  const name = cause instanceof Error ? cause.name : "";
  if (isUpstashFilterError(cause) || name === ARGUMENT_ERROR) {
    return invalidArgument(PROVIDER, errorMessage(cause), cause);
  }
  if (name === CONFLICT_ERROR) {
    return alreadyExists(PROVIDER, index, cause);
  }
  if (name === MISSING_ERROR) {
    return notFound(PROVIDER, index, cause);
  }
  if (isConnectionFailure(cause)) {
    return connection(PROVIDER, cause);
  }
  const message = errorMessage(cause);
  if (UNAUTHORIZED_PATTERN.test(message)) {
    return unauthorized(PROVIDER, cause);
  }
  if (NOT_FOUND_PATTERN.test(message)) {
    return notFound(PROVIDER, index, cause);
  }
  if (ALREADY_EXISTS_PATTERN.test(message)) {
    return alreadyExists(PROVIDER, index, cause);
  }
  if (INVALID_ARGUMENT_PATTERN.test(message)) {
    return invalidArgument(PROVIDER, message, cause);
  }
  return providerError(PROVIDER, cause);
};

const run = <T>(index: string, action: () => Promise<T>): VecResult<T> =>
  attempt((cause) => normalizeUpstashError(cause, index), action);

const namespaceFilter = (namespace: string): Filter =>
  namespace === DEFAULT_NAMESPACE
    ? or(
        not(exists(UPSTASH_NAMESPACE_KEY)),
        eq(UPSTASH_NAMESPACE_KEY, DEFAULT_NAMESPACE)
      )
    : eq(UPSTASH_NAMESPACE_KEY, namespace);

export const scopeUpstashFilter = (
  namespace?: string,
  filter?: Filter
): string => {
  const scope = namespaceFilter(namespace ?? DEFAULT_NAMESPACE);
  return compileUpstashFilter(
    filter === undefined ? scope : and(scope, filter)
  );
};

const requireUrlSafe = (label: string, value: string): void => {
  if (encodeURIComponent(value) !== value) {
    throw taggedError(
      ARGUMENT_ERROR,
      `Upstash puts the ${label} straight into the request path, so it cannot contain a character that needs URL escaping. Received "${value}".`
    );
  }
};

const toStoredId = (namespace: string, id: string): string =>
  namespace === DEFAULT_NAMESPACE ? id : `${namespace}/${id.length}/${id}`;

const toStoredRecord = (
  namespace: string,
  record: VectorRecord
): UpstashRecordLike => {
  const entries: MetadataEntry[] = Object.entries(record.metadata ?? {});
  if (namespace !== DEFAULT_NAMESPACE) {
    entries.push(
      [UPSTASH_ID_KEY, record.id],
      [UPSTASH_NAMESPACE_KEY, namespace]
    );
  }
  return {
    id: toStoredId(namespace, record.id),
    metadata: Object.fromEntries(entries),
    vector: [...record.vector],
  };
};

type UpstashResultRecord = UpstashScoredRecord | UpstashStoredRecord;

const metadataEntries = (record: UpstashResultRecord): MetadataEntry[] =>
  Object.entries(record.metadata ?? {}).filter(isMetadataEntry);

const readStoredId = (record: UpstashResultRecord): string => {
  const stored = metadataEntries(record).find(
    ([key]) => key === UPSTASH_ID_KEY
  );
  return stored !== undefined && isString(stored[1])
    ? stored[1]
    : String(record.id);
};

interface UpstashLayout {
  readonly upstashNamespace: (index: string, namespace: string) => string;
  readonly storedId: (namespace: string, id: string) => string;
  readonly storedRecord: (
    namespace: string,
    record: VectorRecord
  ) => UpstashRecordLike;
  readonly compileFilter: (namespace: string, filter: Filter) => string;
  readonly defaultFilter?: (namespace: string) => string;
  readonly clear: (
    client: UpstashIndexLike,
    index: string,
    namespace: string
  ) => Promise<void>;
  readonly readId: (record: UpstashResultRecord) => string;
  readonly readMetadata: (record: UpstashResultRecord) => Metadata;
  readonly indexOf: (upstashNamespace: string) => string;
  readonly owns: (index: string, upstashNamespace: string) => boolean;
}

const INDEX_LABEL = "index name";

const metadataNamespace = (index: string): string => {
  requireUrlSafe(INDEX_LABEL, index);
  return index;
};

const METADATA_LAYOUT: UpstashLayout = {
  clear: async (client, index, namespace) => {
    await client.delete(
      { filter: scopeUpstashFilter(namespace) },
      { namespace: metadataNamespace(index) }
    );
  },
  compileFilter: (namespace, filter) => scopeUpstashFilter(namespace, filter),
  defaultFilter: (namespace) => scopeUpstashFilter(namespace),
  indexOf: (upstashNamespace) => upstashNamespace,
  owns: (index, upstashNamespace) => upstashNamespace === index,
  readId: readStoredId,
  readMetadata: (record) =>
    metadataFromEntries(metadataEntries(record), RESERVED_KEYS),
  storedId: toStoredId,
  storedRecord: toStoredRecord,
  upstashNamespace: metadataNamespace,
};

const nativeNamespace = (index: string, namespace: string): string => {
  if (index.includes(NAMESPACE_SEPARATOR)) {
    throw taggedError(
      ARGUMENT_ERROR,
      `In native namespace mode the adapter joins the index name and the namespace with "${NAMESPACE_SEPARATOR}", so an index name cannot contain it. Received "${index}".`
    );
  }
  requireUrlSafe(INDEX_LABEL, index);
  if (namespace === DEFAULT_NAMESPACE) {
    return index;
  }
  requireUrlSafe("namespace", namespace);
  return `${index}${NAMESPACE_SEPARATOR}${namespace}`;
};

const NATIVE_LAYOUT: UpstashLayout = {
  clear: async (client, index, namespace) => {
    await client.reset({ namespace: nativeNamespace(index, namespace) });
  },
  compileFilter: (_namespace, filter) => compileUpstashFilter(filter),
  indexOf: (upstashNamespace) =>
    upstashNamespace.split(NAMESPACE_SEPARATOR)[0] ?? upstashNamespace,
  owns: (index, upstashNamespace) =>
    upstashNamespace === index ||
    upstashNamespace.startsWith(`${index}${NAMESPACE_SEPARATOR}`),
  readId: (record) => String(record.id),
  readMetadata: (record) => metadataFromEntries(metadataEntries(record)),
  storedId: (_namespace, id) => id,
  storedRecord: (_namespace, record) => ({
    id: record.id,
    metadata: { ...record.metadata },
    vector: [...record.vector],
  }),
  upstashNamespace: nativeNamespace,
};

const LAYOUTS: Record<UpstashNamespaceMode, UpstashLayout> = {
  metadata: METADATA_LAYOUT,
  native: NATIVE_LAYOUT,
};

const describeSpecMismatch = (
  spec: IndexSpec,
  info: UpstashInfo
): string | undefined => {
  if (info.dimension !== spec.dimension) {
    return `The Upstash index has dimension ${info.dimension}, but "${spec.name}" asked for ${spec.dimension}. Dimension is fixed when the Upstash index is created.`;
  }
  if (
    spec.metric !== undefined &&
    SIMILARITIES[spec.metric] !== info.similarityFunction
  ) {
    return `The Upstash index uses the ${info.similarityFunction} similarity function, but "${spec.name}" asked for ${spec.metric}. The similarity function is fixed when the Upstash index is created.`;
  }
  return undefined;
};

const createIndex = (
  client: UpstashIndexLike,
  layout: UpstashLayout,
  name: string,
  options: IndexOptions
): VectorIndex => {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const scope = (): UpstashNamespaceOptions => ({
    namespace: layout.upstashNamespace(name, namespace),
  });
  return {
    delete: (selector: DeleteSelector) =>
      run(name, async () => {
        if ("ids" in selector) {
          const ids = selector.ids.map((id) => layout.storedId(namespace, id));
          const target = scope();
          await Promise.all(
            chunk(ids, ID_BATCH).map((batch) =>
              client.delete({ ids: batch }, target)
            )
          );
          return;
        }
        if ("filter" in selector) {
          await client.delete(
            { filter: layout.compileFilter(namespace, selector.filter) },
            scope()
          );
          return;
        }
        await layout.clear(client, name, namespace);
      }),

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(name, async () => {
        const includeVectors = fetchOptions.includeVector ?? false;
        const target = scope();
        const batches = chunk(
          ids.map((id) => layout.storedId(namespace, id)),
          ID_BATCH
        );
        const responses = await Promise.all(
          batches.map((batch) =>
            client.fetch(batch, {
              ...target,
              includeMetadata: true,
              includeVectors,
            })
          )
        );
        const records: VectorRecord[] = [];
        for (const record of responses.flat()) {
          if (record !== null) {
            records.push({
              id: layout.readId(record),
              metadata: layout.readMetadata(record),
              vector: record.vector ?? [],
            });
          }
        }
        return sortByIds(ids, records);
      }),

    name,

    namespace: options.namespace,

    query: (query: QueryOptions) =>
      run(name, async () => {
        const includeMetadata = query.includeMetadata ?? true;
        const matches = await client.query(
          {
            filter:
              query.filter === undefined
                ? layout.defaultFilter?.(namespace)
                : layout.compileFilter(namespace, query.filter),
            includeMetadata: true,
            includeVectors: query.includeVector ?? false,
            topK: query.topK,
            vector: [...query.vector],
          },
          scope()
        );
        return matches.map((match): ScoredRecord => ({
          id: layout.readId(match),
          metadata: includeMetadata ? layout.readMetadata(match) : undefined,
          score: match.score,
          vector: match.vector,
        }));
      }),

    upsert: (records) =>
      run(name, async () => {
        const target = scope();
        const stored = records.map((record) =>
          layout.storedRecord(namespace, record)
        );
        await Promise.all(
          chunk(stored, UPSERT_BATCH).map((batch) =>
            client.upsert(batch, target)
          )
        );
      }),
  };
};

export const createUpstashStore = <Client extends UpstashIndexLike>(
  options: UpstashStoreOptions<Client>
): VectorStore<Client> => {
  const { client } = options;
  const layout = LAYOUTS[options.namespaceMode ?? "metadata"];
  return {
    createIndex: (spec: IndexSpec) =>
      run(spec.name, async () => {
        const info = await client.info();
        const mismatch = describeSpecMismatch(spec, info);
        if (mismatch !== undefined) {
          throw taggedError(ARGUMENT_ERROR, mismatch);
        }
        const existing = await client.listNamespaces();
        if (existing.some((found) => layout.owns(spec.name, found))) {
          throw taggedError(
            CONFLICT_ERROR,
            `The Upstash index already has a namespace for "${spec.name}".`
          );
        }
      }),

    deleteIndex: (name) =>
      run(name, async () => {
        const existing = await client.listNamespaces();
        const owned = existing.filter((found) => layout.owns(name, found));
        if (owned.length === 0) {
          throw taggedError(
            MISSING_ERROR,
            `The Upstash index has no namespace for "${name}".`
          );
        }
        await Promise.all(owned.map((found) => client.deleteNamespace(found)));
      }),

    index: (name, indexOptions = {}) =>
      createIndex(client, layout, name, indexOptions),

    listIndexes: () =>
      run("", async () => {
        const existing = await client.listNamespaces();
        const names = new Set(existing.map((found) => layout.indexOf(found)));
        names.delete(DEFAULT_NAMESPACE);
        return [...names];
      }),

    provider: PROVIDER,

    raw: client,
  };
};
