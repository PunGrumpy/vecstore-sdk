import {
  alreadyExists,
  connection,
  invalidArgument,
  notFound,
  providerError,
  unauthorized,
} from "../errors";
import type { VecstoreError } from "../errors";
import { compilePgvectorFilter } from "../filter/pgvector";
import type { PgvectorSql } from "../filter/pgvector";
import { attempt } from "../internal/attempt";
import { chunk, sortByIds } from "../internal/collections";
import { isNumberArray, isObjectLike, isString } from "../internal/guards";
import { isMetadataEntry, metadataFromEntries } from "../internal/metadata";
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

export {
  type CompilePgvectorFilterOptions,
  compilePgvectorFilter,
  type PgvectorSql,
} from "../filter/pgvector";

export type PgParam = string | number | string[];

export interface PgStatement {
  readonly text: string;
  readonly params: PgParam[];
}

export interface PgQueryResult {
  readonly rows: object[];
}

export interface PgQueryable {
  readonly query: (text: string, params: PgParam[]) => Promise<PgQueryResult>;
}

export interface PgvectorStoreOptions<Client> {
  readonly client: Client;
  readonly schema?: string;
}

const PROVIDER = "pgvector";
const UPSERT_BATCH = 500;
const UPSERT_COLUMNS = 4;
const DEFAULT_NAMESPACE = "";

const OPCLASSES: Record<Metric, string> = {
  cosine: "vector_cosine_ops",
  dot: "vector_ip_ops",
  euclidean: "vector_l2_ops",
};

const DISTANCE_OPERATORS: Record<Metric, string> = {
  cosine: "<=>",
  dot: "<#>",
  euclidean: "<->",
};

const PG_UNDEFINED_TABLE = "42P01";
const PG_DUPLICATE_TABLE = "42P07";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_ADMIN_SHUTDOWN = "57P01";
const PG_CONNECTION_CLASS = "08";
const PG_AUTH_CLASS = "28";
const PG_DATA_CLASS = "22";
const PG_INTEGRITY_CLASS = "23";
const PG_SYNTAX_CLASS = "42";
const NODE_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
]);

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const vectorLiteral = (vector: readonly number[]): string =>
  `[${vector.join(",")}]`;

const hasCode = (cause: unknown): cause is Error & { code: string } =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string";

const isConnectionCode = (code: string): boolean =>
  NODE_CONNECTION_CODES.has(code) ||
  code === PG_ADMIN_SHUTDOWN ||
  code.startsWith(PG_CONNECTION_CLASS);

const isAuthCode = (code: string): boolean =>
  code === PG_INSUFFICIENT_PRIVILEGE || code.startsWith(PG_AUTH_CLASS);

const isArgumentCode = (code: string): boolean =>
  code.startsWith(PG_DATA_CLASS) ||
  code.startsWith(PG_INTEGRITY_CLASS) ||
  code.startsWith(PG_SYNTAX_CLASS);

export const normalizePgvectorError = (
  cause: unknown,
  index: string
): VecstoreError => {
  if (!hasCode(cause)) {
    return providerError(PROVIDER, cause);
  }
  const { code } = cause;
  if (code === PG_UNDEFINED_TABLE) {
    return notFound(PROVIDER, index, cause);
  }
  if (code === PG_DUPLICATE_TABLE) {
    return alreadyExists(PROVIDER, index, cause);
  }
  if (isConnectionCode(code)) {
    return connection(PROVIDER, cause);
  }
  if (isAuthCode(code)) {
    return unauthorized(PROVIDER, cause);
  }
  if (isArgumentCode(code)) {
    return invalidArgument(PROVIDER, cause.message, cause);
  }
  return providerError(PROVIDER, cause);
};

const run = <T>(index: string, action: () => Promise<T>): VecResult<T> =>
  attempt((cause) => normalizePgvectorError(cause, index), action);

interface RecordRow {
  readonly id: string;
  readonly metadata?: object | null;
  readonly embedding?: string;
  readonly score?: number;
}

const isRecordRow = (row: unknown): row is RecordRow =>
  isObjectLike(row) && "id" in row && typeof row.id === "string";

interface IndexDefinitionRow {
  readonly indexdef: string;
}

const isIndexDefinitionRow = (row: unknown): row is IndexDefinitionRow =>
  isObjectLike(row) && "indexdef" in row && typeof row.indexdef === "string";

interface NamedRow {
  readonly name: string;
}

const isNamedRow = (row: unknown): row is NamedRow =>
  isObjectLike(row) && "name" in row && typeof row.name === "string";

const readMetadata = (row: RecordRow): Metadata =>
  metadataFromEntries(
    Object.entries(row.metadata ?? {}).filter(isMetadataEntry)
  );

const readVector = (row: RecordRow): number[] => {
  if (!isString(row.embedding)) {
    return [];
  }
  const parsed = JSON.parse(row.embedding);
  return isNumberArray(parsed) ? parsed : [];
};

const toVectorRecord = (row: RecordRow): VectorRecord => ({
  id: row.id,
  metadata: readMetadata(row),
  vector: readVector(row),
});

const toScoredRecord = (
  row: RecordRow,
  includeMetadata: boolean,
  includeVector: boolean
): ScoredRecord => ({
  id: row.id,
  metadata: includeMetadata ? readMetadata(row) : undefined,
  score: row.score ?? 0,
  vector: includeVector ? readVector(row) : undefined,
});

const OPCLASS_METRICS: readonly (readonly [string, Metric])[] = [
  [OPCLASSES.cosine, "cosine"],
  [OPCLASSES.dot, "dot"],
  [OPCLASSES.euclidean, "euclidean"],
];

const metricFromIndexDef = (definition: string): Metric | undefined =>
  OPCLASS_METRICS.find(([opclass]) => definition.includes(opclass))?.[1];

const scoreExpression = (metric: Metric, vectorParam: string): string => {
  const distance = `embedding ${DISTANCE_OPERATORS[metric]} ${vectorParam}::vector`;
  switch (metric) {
    case "cosine": {
      return `1 - (${distance})`;
    }
    case "dot": {
      return `-(${distance})`;
    }
    case "euclidean": {
      return distance;
    }
    default: {
      const exhaustive: never = metric;
      return exhaustive;
    }
  }
};

interface TableContext {
  readonly client: PgQueryable;
  readonly name: string;
  readonly schema: string | undefined;
  readonly table: string;
}

const schemaPredicate = (schema: string | undefined, param: string): string =>
  schema === undefined ? "current_schema()" : param;

const resolveMetric = async (context: TableContext): Promise<Metric> => {
  const params: PgParam[] =
    context.schema === undefined
      ? [context.name]
      : [context.name, context.schema];
  const { rows } = await context.client.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND schemaname = ${schemaPredicate(context.schema, "$2")}`,
    params
  );
  for (const row of rows.filter(isIndexDefinitionRow)) {
    const metric = metricFromIndexDef(row.indexdef);
    if (metric !== undefined) {
      return metric;
    }
  }
  return "cosine";
};

const upsertStatement = (
  table: string,
  namespace: string,
  batch: readonly VectorRecord[]
): PgStatement => {
  const params: PgParam[] = [];
  const rows = batch.map((record, rowIndex) => {
    const base = rowIndex * UPSERT_COLUMNS;
    params.push(
      record.id,
      namespace,
      vectorLiteral(record.vector),
      JSON.stringify(record.metadata ?? {})
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}::vector, $${base + 4}::jsonb)`;
  });
  return {
    params,
    text: `INSERT INTO ${table} (id, namespace, embedding, metadata) VALUES ${rows.join(", ")} ON CONFLICT (namespace, id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
  };
};

const createIndex = (
  context: TableContext,
  options: IndexOptions
): VectorIndex => {
  const { client, name, table } = context;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  let metric: Metric | undefined;
  const getMetric = async (): Promise<Metric> => {
    metric ??= await resolveMetric(context);
    return metric;
  };

  return {
    delete: (selector: DeleteSelector) =>
      run(name, async () => {
        if ("ids" in selector) {
          await client.query(
            `DELETE FROM ${table} WHERE namespace = $1 AND id = ANY($2::text[])`,
            [namespace, [...selector.ids]]
          );
          return;
        }
        if ("filter" in selector) {
          const filter = compilePgvectorFilter(selector.filter, {
            startIndex: 2,
          });
          await client.query(
            `DELETE FROM ${table} WHERE namespace = $1 AND ${filter.text}`,
            [namespace, ...filter.params]
          );
          return;
        }
        await client.query(`DELETE FROM ${table} WHERE namespace = $1`, [
          namespace,
        ]);
      }),

    fetch: (ids, fetchOptions: FetchOptions = {}) =>
      run(name, async () => {
        if (ids.length === 0) {
          return [];
        }
        const vectorColumn = fetchOptions.includeVector
          ? ", embedding::text AS embedding"
          : "";
        const { rows } = await client.query(
          `SELECT id, metadata${vectorColumn} FROM ${table} WHERE namespace = $1 AND id = ANY($2::text[])`,
          [namespace, [...ids]]
        );
        const records = rows.flatMap((row) =>
          isRecordRow(row) ? [toVectorRecord(row)] : []
        );
        return sortByIds(ids, records);
      }),

    name,

    namespace: options.namespace,

    query: (query: QueryOptions) =>
      run(name, async () => {
        const resolved = await getMetric();
        const params: PgParam[] = [namespace, vectorLiteral(query.vector)];
        const filter: PgvectorSql | undefined =
          query.filter === undefined
            ? undefined
            : compilePgvectorFilter(query.filter, {
                startIndex: params.length + 1,
              });
        if (filter !== undefined) {
          params.push(...filter.params);
        }
        params.push(query.topK);
        const where =
          filter === undefined
            ? "namespace = $1"
            : `namespace = $1 AND ${filter.text}`;
        const vectorColumn = query.includeVector
          ? "embedding::text AS embedding,"
          : "";
        const { rows } = await client.query(
          `SELECT id, metadata, ${vectorColumn} ${scoreExpression(resolved, "$2")} AS score FROM ${table} WHERE ${where} ORDER BY embedding ${DISTANCE_OPERATORS[resolved]} $2::vector LIMIT $${params.length}`,
          params
        );
        const includeMetadata = query.includeMetadata ?? true;
        return rows.flatMap((row) =>
          isRecordRow(row)
            ? [
                toScoredRecord(
                  row,
                  includeMetadata,
                  query.includeVector ?? false
                ),
              ]
            : []
        );
      }),

    upsert: (records) =>
      run(name, async () => {
        await Promise.all(
          chunk(records, UPSERT_BATCH).map((batch) => {
            const statement = upsertStatement(table, namespace, batch);
            return client.query(statement.text, statement.params);
          })
        );
      }),
  };
};

export const createPgvectorStore = <Client extends PgQueryable>(
  options: PgvectorStoreOptions<Client>
): VectorStore<Client> => {
  const { client, schema } = options;
  const tableRef = (name: string): string =>
    schema === undefined
      ? quoteIdent(name)
      : `${quoteIdent(schema)}.${quoteIdent(name)}`;
  const context = (name: string): TableContext => ({
    client,
    name,
    schema,
    table: tableRef(name),
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
      return run(spec.name, async () => {
        const table = tableRef(spec.name);
        const embeddingIndex = quoteIdent(`${spec.name}_embedding_idx`);
        const metadataIndex = quoteIdent(`${spec.name}_metadata_idx`);
        const opclass = OPCLASSES[spec.metric ?? "cosine"];
        await client.query("CREATE EXTENSION IF NOT EXISTS vector", []);
        await client.query(
          `CREATE TABLE ${table} (id text NOT NULL, namespace text NOT NULL DEFAULT '', embedding vector(${spec.dimension}) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (namespace, id))`,
          []
        );
        await client.query(
          `CREATE INDEX ${embeddingIndex} ON ${table} USING hnsw (embedding ${opclass})`,
          []
        );
        await client.query(
          `CREATE INDEX ${metadataIndex} ON ${table} USING gin (metadata)`,
          []
        );
      });
    },

    deleteIndex: (name) =>
      run(name, async () => {
        await client.query(`DROP TABLE ${tableRef(name)}`, []);
      }),

    index: (name, indexOptions = {}) =>
      createIndex(context(name), indexOptions),

    listIndexes: () =>
      run("", async () => {
        const params: PgParam[] = schema === undefined ? [] : [schema];
        const { rows } = await client.query(
          `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid JOIN pg_type t ON t.oid = a.atttypid WHERE c.relkind = 'r' AND a.attname = 'embedding' AND t.typname = 'vector' AND n.nspname = ${schemaPredicate(schema, "$1")} ORDER BY c.relname`,
          params
        );
        return rows.flatMap((row) => (isNamedRow(row) ? [row.name] : []));
      }),

    provider: PROVIDER,

    raw: client,
  };
};
