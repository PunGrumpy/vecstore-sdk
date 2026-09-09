<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/PunGrumpy/vecstore-sdk/raw/HEAD/assets/hero-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/PunGrumpy/vecstore-sdk/raw/HEAD/assets/hero-light.png">
  <img alt="One API for vector stores. vecstore-sdk is an open-source TypeScript library that compiles one metadata filter to Qdrant, pgvector, and Pinecone." src="https://github.com/PunGrumpy/vecstore-sdk/raw/HEAD/assets/hero-light.png">
</picture>

# VecStore SDK

One TypeScript API for Qdrant, pgvector, and Pinecone. You write one metadata filter, and each adapter compiles it to the provider's native syntax, so switching providers changes one import and one config object.

[![npm version](https://img.shields.io/npm/v/vecstore-sdk?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/vecstore-sdk) [![npm downloads](https://img.shields.io/npm/dm/vecstore-sdk?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/vecstore-sdk) [![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](LICENSE)

## Why

Vector databases agree on the verbs (upsert, query, fetch, delete) and disagree on the rest. Pinecone filters use MongoDB-style operators, Qdrant uses `must` and `should` clauses, pgvector uses SQL. Qdrant only accepts UUID point ids. Pinecone has native namespaces. The others do not. Each SDK throws its own error classes.

vecstore-sdk hides those differences behind a small adapter API:

- A filter type with builders (`eq`, `gt`, `isIn`, `and`, `or`, `not`) that compiles to each provider.
- Four record verbs and three index verbs with the same signatures everywhere.
- Namespaces on every provider, emulated where the provider lacks them.
- Errors as a discriminated union you match on, never thrown.
- A `raw` property that returns the native client you passed in.

Embedding is out of scope. Generate vectors with your model provider and pass the numbers in.

## Install

Install the package and the SDK for the provider you use. Provider SDKs are optional peer dependencies. The adapters import only their types, so your bundle contains only the SDK you installed.

```bash
bun add vecstore-sdk @qdrant/js-client-rest
bun add vecstore-sdk pg
bun add vecstore-sdk @pinecone-database/pinecone
```

## Get started

Create a store from a native client, create an index, write records, and query with a filter:

```ts
import { QdrantClient } from "@qdrant/js-client-rest";
import { and, eq, gt } from "vecstore-sdk";
import { createQdrantStore } from "vecstore-sdk/qdrant";

const store = createQdrantStore({
  client: new QdrantClient({ url: "http://localhost:6333" }),
});

await store.createIndex({ name: "docs", dimension: 1536, metric: "cosine" });

const docs = store.index("docs", { namespace: "tenant_1" });

await docs.upsert([
  { id: "doc-1", vector: embedding, metadata: { genre: "drama", year: 2010 } },
]);

const result = await docs.query({
  vector: queryEmbedding,
  topK: 5,
  filter: and(eq("genre", "drama"), gt("year", 2000)),
});

if (!result.ok) {
  throw new Error(result.error.message);
}

for (const match of result.value) {
  console.log(match.id, match.score, match.metadata);
}
```

To move to pgvector, swap the first two lines and keep the rest:

```ts
import { Pool } from "pg";
import { createPgvectorStore } from "vecstore-sdk/pgvector";

const store = createPgvectorStore({ client: new Pool({ connectionString }) });
```

## API

Every verb returns a `Result`, either `{ ok: true, value }` or `{ ok: false, error }`. Provider failures never throw.

### Store

| Method | Description |
| --- | --- |
| `createIndex({ name, dimension, metric? })` | Creates a collection, table, or index. `metric` is `cosine` (default), `euclidean`, or `dot`. |
| `deleteIndex(name)` | Drops it. Returns `not_found` if it does not exist. |
| `listIndexes()` | Returns index names. |
| `index(name, { namespace? })` | Returns an index handle scoped to one namespace. |
| `raw` | The client you passed in, with its original type. |

### Index

| Method | Description |
| --- | --- |
| `upsert(records)` | Inserts or replaces records by id. |
| `query({ vector, topK, filter?, includeMetadata?, includeVector? })` | Returns the nearest records with `score`. |
| `fetch(ids, { includeVector? })` | Returns the records that exist, in request order. |
| `delete({ ids })`, `delete({ filter })`, `delete({ all: true })` | Removes records in the namespace. |

Metadata values are `string`, `number`, `boolean`, or `string[]`. That is the intersection the three providers accept.

Scores are the provider's native score for the index metric. Higher is better for `cosine` and `dot`. Lower is better for `euclidean`.

### Filters

Build filters with the exported helpers. Each compiler is also exported from its adapter, so you can inspect or reuse the native output.

| Builder | Qdrant | pgvector | Pinecone |
| --- | --- | --- | --- |
| `eq(field, value)` | `match.value`, or a closed `range` for floats | `metadata @> '{"field": value}'` | `{ field: { $eq } }` |
| `ne(field, value)` | `must_not` of the above | `NOT (metadata @> ...)` | `$ne` |
| `gt`, `gte`, `lt`, `lte` | `range` | jsonb comparison guarded by `jsonb_typeof` | `$gt`, `$gte`, `$lt`, `$lte` |
| `isIn(field, values)` | `match.any`, or `should` for mixed types | `metadata->field <@ values` | `$in`, or `$or` of `$eq` for booleans |
| `notIn(field, values)` | `match.except`, or `must_not` | `NOT COALESCE(... <@ ..., false)` | `$nin`, or `$and` of `$ne` for booleans |
| `exists(field)` | `must_not is_empty` | `IS NOT NULL AND jsonb_typeof <> 'null'` | `$exists: true` |
| `and`, `or` | `must`, `should` | `AND`, `OR` | `$and`, `$or` |
| `not(filter)` | `must_not` | `NOT (...)` | Pushed to the leaves with De Morgan's laws |

`isIn`, `notIn`, `and`, and `or` require at least one element, and the types enforce it.

### Errors

`error.kind` is one of:

| Kind | Meaning |
| --- | --- |
| `not_found` | The index does not exist. Carries `name`. |
| `already_exists` | `createIndex` hit an existing index. |
| `invalid_argument` | The provider rejected the request: wrong dimension, bad id, bad metadata. |
| `unsupported` | The provider cannot do this. Carries `feature`, for example `deleteByFilter` on Pinecone serverless. |
| `unauthorized` | Bad credentials or missing permission. |
| `connection` | The provider was unreachable or timed out. |
| `provider` | Anything else. `cause` holds the original error. |

## Adapters

### Qdrant

```ts
import { createQdrantStore } from "vecstore-sdk/qdrant";
const store = createQdrantStore({ client: new QdrantClient({ url, apiKey }) });
```

An index is a collection. Qdrant accepts only UUID or integer point ids. The adapter hashes other ids to a deterministic UUID and stores your id in the `_id` payload key. Lowercase UUID ids in the default namespace pass through unchanged. Namespaces live in the `_namespace` payload key, and `createIndex` adds a tenant keyword index on it. The adapter strips both keys from returned metadata.

### pgvector

```ts
import { createPgvectorStore } from "vecstore-sdk/pgvector";
const store = createPgvectorStore({ client: pool, schema: "public" });
```

The client is anything with `query(text, params)` that resolves to `{ rows }`. A `pg` Pool or Client works as is. For postgres.js, pass `{ query: (text, params) => sql.unsafe(text, params) }`.

`createIndex` runs `CREATE EXTENSION IF NOT EXISTS vector` and creates this table plus an HNSW index for the metric and a GIN index on `metadata`:

```sql
CREATE TABLE "docs" (
  id text NOT NULL,
  namespace text NOT NULL DEFAULT '',
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (namespace, id)
);
```

Queries read the metric from the HNSW or IVFFlat index definition and default to cosine when no index exists. `listIndexes` returns tables in the schema that have an `embedding vector` column.

### Pinecone

```ts
import { createPineconeStore } from "vecstore-sdk/pinecone";
const store = createPineconeStore({
  client: new Pinecone({ apiKey }),
  indexSpec: { serverless: { cloud: "aws", region: "us-east-1" } },
});
```

Indexes and namespaces map one to one. `indexSpec` defaults to serverless on AWS in `us-east-1`. `createIndex` waits until the index is ready. Serverless indexes reject `delete({ filter })`. The adapter returns an `unsupported` error with `feature: "deleteByFilter"` in that case.

## Semantics that differ

The compilers are exact for scalar fields. Two cases differ across providers:

- Negations (`ne`, `notIn`, `not`) match records that lack the field on Qdrant and pgvector. Pinecone applies operators to present fields only.
- `eq` and `isIn` on array-valued fields mean "contains" on Qdrant and pgvector. Pinecone supports `$in` on list fields and rejects `$eq`.

## Testing

Unit tests run with `bun test` against in-memory fakes:

```bash
bun run test
```

Live tests run the same conformance suite against real backends. Set `VECSTORE_LIVE=1` and the connection variables for the providers you have:

```bash
QDRANT_URL=http://localhost:6333 \
PGVECTOR_URL=postgres://postgres:postgres@localhost:5432/postgres \
PINECONE_API_KEY=pcsk_1234567890 \
bun run test:live
```

The suite skips providers without a variable.

## Not in v0

Embedding generation, hybrid and sparse search, reranking, chunking, and an Effect integration. See [docs/design.md](../../docs/design.md) for the reasoning.

## License

MIT
