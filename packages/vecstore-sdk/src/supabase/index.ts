import {
  connection,
  invalidArgument,
  unauthorized,
  unsupported,
} from "../errors";
import type { VecstoreError } from "../errors";
import type { Filter } from "../filter/ast";
import { attempt } from "../internal/attempt";
import { chunk, sortByIds } from "../internal/collections";
import {
  hasCode,
  isNamedRow,
  isPostgresRow,
  normalizePostgresError,
  toScoredRecord,
  toVectorRecord,
  vectorLiteral,
} from "../internal/postgres";
import { err } from "../result";
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

export interface SupabaseRpcError {
  readonly message: string;
  readonly code?: string;
}

export interface SupabaseRpcResponse {
  readonly data: readonly object[] | null;
  readonly error: SupabaseRpcError | null;
}

export interface SupabaseIndexTarget {
  readonly index_name: string;
  readonly index_schema: string | null;
}

export interface SupabaseNamespaceTarget extends SupabaseIndexTarget {
  readonly match_namespace: string;
}

export interface SupabaseUpsertRow {
  readonly id: string;
  readonly embedding: string;
  readonly metadata: Metadata;
}

export type SupabaseCall =
  | {
      readonly fn: "vecstore_create_index";
      readonly args: SupabaseIndexTarget & {
        readonly dimension: number;
        readonly metric: Metric;
      };
    }
  | { readonly fn: "vecstore_drop_index"; readonly args: SupabaseIndexTarget }
  | {
      readonly fn: "vecstore_list_indexes";
      readonly args: { readonly index_schema: string | null };
    }
  | {
      readonly fn: "vecstore_upsert";
      readonly args: SupabaseNamespaceTarget & {
        readonly records: readonly SupabaseUpsertRow[];
      };
    }
  | {
      readonly fn: "vecstore_query";
      readonly args: SupabaseNamespaceTarget & {
        readonly include_vector: boolean;
        readonly match_count: number;
        readonly match_filter: Filter | null;
        readonly query_embedding: string;
      };
    }
  | {
      readonly fn: "vecstore_fetch";
      readonly args: SupabaseNamespaceTarget & {
        readonly ids: readonly string[];
        readonly include_vector: boolean;
      };
    }
  | {
      readonly fn: "vecstore_delete";
      readonly args: SupabaseNamespaceTarget & {
        readonly ids: readonly string[] | null;
        readonly match_filter: Filter | null;
      };
    };

export interface SupabaseClientLike {
  readonly rpc: (
    fn: string,
    args: SupabaseCall["args"]
  ) => PromiseLike<SupabaseRpcResponse>;
}

export interface SupabaseStoreOptions<Client> {
  readonly client: Client;
  readonly schema?: string;
}

const PROVIDER = "supabase";
const UPSERT_BATCH = 100;
const DEFAULT_NAMESPACE = "";

const MISSING_FUNCTION = "PGRST202";
const JWT_CODES = new Set(["PGRST301", "PGRST302", "401", "403"]);
const FETCH_FAILURE = /failed to fetch|fetch failed|network request failed/iu;

const INSTALL_HINT =
  "Run sql/supabase.sql from vecstore-sdk in your Supabase project";

interface CallContext {
  readonly fn: SupabaseCall["fn"];
  readonly index: string;
}

const isFetchFailure = (cause: unknown): boolean =>
  cause instanceof TypeError ||
  (cause instanceof Error && FETCH_FAILURE.test(cause.message));

export const normalizeSupabaseError = (
  cause: unknown,
  context: CallContext
): VecstoreError => {
  if (isFetchFailure(cause)) {
    return connection(PROVIDER, cause);
  }
  if (hasCode(cause)) {
    if (cause.code === MISSING_FUNCTION) {
      return unsupported(
        PROVIDER,
        context.fn,
        `${context.fn} is not installed. ${INSTALL_HINT}.`
      );
    }
    if (JWT_CODES.has(cause.code)) {
      return unauthorized(PROVIDER, cause);
    }
  }
  return normalizePostgresError(PROVIDER, cause, context.index);
};

const rpcFailure = (error: SupabaseRpcError): Error & { code: string } =>
  Object.assign(new Error(error.message, { cause: error }), {
    code: error.code ?? "",
  });

const invoke = async (
  client: SupabaseClientLike,
  call: SupabaseCall
): Promise<readonly object[]> => {
  const response = await client.rpc(call.fn, call.args);
  if (response.error !== null && response.error !== undefined) {
    throw rpcFailure(response.error);
  }
  return response.data ?? [];
};

const run = <T>(context: CallContext, action: () => Promise<T>): VecResult<T> =>
  attempt((cause) => normalizeSupabaseError(cause, context), action);

const readRecords = (rows: readonly object[]): VectorRecord[] =>
  rows.flatMap((row) => (isPostgresRow(row) ? [toVectorRecord(row)] : []));

const readScored = (
  rows: readonly object[],
  includeMetadata: boolean,
  includeVector: boolean
): ScoredRecord[] =>
  rows.flatMap((row) =>
    isPostgresRow(row)
      ? [toScoredRecord(row, includeMetadata, includeVector)]
      : []
  );

const readNames = (rows: readonly object[]): string[] =>
  rows.flatMap((row) => (isNamedRow(row) ? [row.name] : []));

const toUpsertRow = (record: VectorRecord): SupabaseUpsertRow => ({
  embedding: vectorLiteral(record.vector),
  id: record.id,
  metadata: record.metadata ?? {},
});

const deleteCall = (
  scope: SupabaseNamespaceTarget,
  selector: DeleteSelector
): SupabaseCall => {
  if ("ids" in selector) {
    return {
      args: { ...scope, ids: [...selector.ids], match_filter: null },
      fn: "vecstore_delete",
    };
  }
  if ("filter" in selector) {
    return {
      args: { ...scope, ids: null, match_filter: selector.filter },
      fn: "vecstore_delete",
    };
  }
  return {
    args: { ...scope, ids: null, match_filter: null },
    fn: "vecstore_delete",
  };
};

const createIndexHandle = (
  client: SupabaseClientLike,
  target: SupabaseIndexTarget,
  options: IndexOptions
): VectorIndex => {
  const scope: SupabaseNamespaceTarget = {
    ...target,
    match_namespace: options.namespace ?? DEFAULT_NAMESPACE,
  };
  const context = (fn: SupabaseCall["fn"]): CallContext => ({
    fn,
    index: target.index_name,
  });

  return {
    delete: (selector: DeleteSelector) =>
      run(context("vecstore_delete"), async () => {
        await invoke(client, deleteCall(scope, selector));
      }),

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(context("vecstore_fetch"), async () => {
        if (ids.length === 0) {
          return [];
        }
        const rows = await invoke(client, {
          args: {
            ...scope,
            ids: [...ids],
            include_vector: fetchOptions.includeVector ?? false,
          },
          fn: "vecstore_fetch",
        });
        return sortByIds(ids, readRecords(rows));
      }),

    name: target.index_name,

    namespace: options.namespace,

    query: (query: QueryOptions) =>
      run(context("vecstore_query"), async () => {
        const includeVector = query.includeVector ?? false;
        const includeMetadata = query.includeMetadata ?? true;
        const rows = await invoke(client, {
          args: {
            ...scope,
            include_vector: includeVector,
            match_count: query.topK,
            match_filter: query.filter ?? null,
            query_embedding: vectorLiteral(query.vector),
          },
          fn: "vecstore_query",
        });
        return readScored(rows, includeMetadata, includeVector);
      }),

    upsert: (records) =>
      run(context("vecstore_upsert"), async () => {
        await Promise.all(
          chunk(records, UPSERT_BATCH).map((batch) =>
            invoke(client, {
              args: { ...scope, records: batch.map(toUpsertRow) },
              fn: "vecstore_upsert",
            })
          )
        );
      }),
  };
};

export const createSupabaseStore = <Client extends SupabaseClientLike>(
  options: SupabaseStoreOptions<Client>
): VectorStore<Client> => {
  const { client } = options;
  const schema = options.schema ?? null;
  const target = (name: string): SupabaseIndexTarget => ({
    index_name: name,
    index_schema: schema,
  });

  return {
    createIndex: (spec: IndexSpec) => {
      if (!Number.isInteger(spec.dimension) || spec.dimension <= 0) {
        return Promise.resolve(
          err(
            invalidArgument(
              PROVIDER,
              `dimension must be a positive integer, got ${spec.dimension}`
            )
          )
        );
      }
      return run(
        { fn: "vecstore_create_index", index: spec.name },
        async () => {
          await invoke(client, {
            args: {
              ...target(spec.name),
              dimension: spec.dimension,
              metric: spec.metric ?? "cosine",
            },
            fn: "vecstore_create_index",
          });
        }
      );
    },

    deleteIndex: (name) =>
      run({ fn: "vecstore_drop_index", index: name }, async () => {
        await invoke(client, { args: target(name), fn: "vecstore_drop_index" });
      }),

    index: (name, indexOptions = {}) =>
      createIndexHandle(client, target(name), indexOptions),

    listIndexes: () =>
      run({ fn: "vecstore_list_indexes", index: "" }, async () => {
        const rows = await invoke(client, {
          args: { index_schema: schema },
          fn: "vecstore_list_indexes",
        });
        return readNames(rows);
      }),

    provider: PROVIDER,

    raw: client,
  };
};
