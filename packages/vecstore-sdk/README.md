<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/PunGrumpy/vecstore-sdk/raw/HEAD/assets/hero-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/PunGrumpy/vecstore-sdk/raw/HEAD/assets/hero-light.png">
  <img alt="One API for vector stores. vecstore-sdk is an open-source TypeScript library that compiles one filter to Qdrant, pgvector, Pinecone, Supabase, Upstash Vector, Cloudflare Vectorize, and Redis." src="https://github.com/PunGrumpy/vecstore-sdk/raw/HEAD/assets/hero-light.png">
</picture>

# VecStore SDK

One TypeScript API for Qdrant, pgvector, Pinecone, Supabase, Upstash Vector, Cloudflare Vectorize, and Redis. You write one metadata filter, and each adapter compiles it to the provider's native syntax, so switching providers changes one import and one config object.

[![npm version](https://img.shields.io/npm/v/vecstore-sdk?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/vecstore-sdk) [![npm downloads](https://img.shields.io/npm/dm/vecstore-sdk?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/vecstore-sdk) [![MIT License](https://img.shields.io/badge/License-MIT-000?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=000&color=000)](LICENSE)

## Why

Vector databases agree on the verbs (upsert, query, fetch, delete) and disagree on the rest. Pinecone filters use MongoDB-style operators, Qdrant uses `must` and `should` clauses, pgvector uses SQL, Upstash uses a SQL-like string, Redis uses its own query language, and Vectorize joins every clause with AND and has no OR at all. Qdrant only accepts UUID point ids, and Vectorize caps an id at 64 bytes. Pinecone and Vectorize have native namespaces. The others do not. Redis indexes a metadata field only when the schema declares it. Supabase reaches Postgres over HTTP, where no vector operator exists. Each SDK throws its own error classes.

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
bun add vecstore-sdk @supabase/supabase-js
bun add vecstore-sdk @upstash/vector
bun add vecstore-sdk cloudflare
bun add vecstore-sdk redis
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

Metadata values are `string`, `number`, `boolean`, or `string[]`. That is the intersection the seven providers accept.

Qdrant, pgvector, Pinecone, and Vectorize return the provider's native score for the index metric. Higher is better for `cosine` and `dot`, lower is better for `euclidean`. Upstash normalizes every metric to the range 0 to 1, where higher is always better. Redis returns a distance for every metric, where lower is closer.

### Filters

Build filters with the exported helpers. Each compiler is also exported from its adapter, so you can inspect or reuse the native output.

| Builder | Qdrant | pgvector and Supabase | Pinecone | Upstash | Vectorize | Redis |
| --- | --- | --- | --- | --- | --- | --- |
| `eq(field, value)` | `match.value`, or a closed `range` for floats | `metadata @> '{"field": value}'` | `{ field: { $eq } }` | `field = value` | `{ field: { $eq } }` | `@field:{"value"}` on a tag, `@field:[v v]` on a number |
| `ne(field, value)` | `must_not` of the above | `NOT (metadata @> ...)` | `$ne` | `field != value` | `$ne` | `-(...)` of the above |
| `gt`, `gte`, `lt`, `lte` | `range` | jsonb comparison guarded by `jsonb_typeof` | `$gt`, `$gte`, `$lt`, `$lte` | `>`, `>=`, `<`, `<=` | `$gt`, `$gte`, `$lt`, `$lte` | `@field:[(v +inf]` and the other three bounds |
| `isIn(field, values)` | `match.any`, or `should` for mixed types | `metadata->field <@ values` | `$in`, or `$or` of `$eq` for booleans | `field IN (...)` | `$in` | `@field:{"a" \| "b"}` on a tag, a union of ranges on a number |
| `notIn(field, values)` | `match.except`, or `must_not` | `NOT COALESCE(... <@ ..., false)` | `$nin`, or `$and` of `$ne` for booleans | `field NOT IN (...)` | `$nin` | `-(...)` of the above |
| `exists(field)` | `must_not is_empty` | `IS NOT NULL AND jsonb_typeof <> 'null'` | `$exists: true` | `HAS FIELD field` | `unsupported` | `-ismissing(@field)` |
| `and`, `or` | `must`, `should` | `AND`, `OR` | `$and`, `$or` | `AND`, `OR` | `and` merges fields into one object, `or` is `unsupported` | a space, `\|` |
| `not(filter)` | `must_not` | `NOT (...)` | Pushed to the leaves with De Morgan's laws | Pushed to the leaves with De Morgan's laws | Pushed to the leaves with De Morgan's laws | `-(...)` around the clause |

`isIn`, `notIn`, `and`, and `or` require at least one element, and the types enforce it.

Supabase has no compiler to import. The filter travels to Postgres as JSON and `vecstore_filter_sql` emits the pgvector predicates there.

Two compilers return a `Result`, and the verb turns a failure into an error before it sends the request. `compileVectorizeFilter` fails because a Vectorize filter is smaller than the filter AST. `compileRedisFilter` fails because it holds the index schema and knows which fields Redis can match on.

### Errors

`error.kind` is one of:

| Kind | Meaning |
| --- | --- |
| `not_found` | The index does not exist. Carries `name`. |
| `already_exists` | `createIndex` hit an existing index. |
| `invalid_argument` | The provider rejected the request: wrong dimension, bad id, bad metadata. |
| `unsupported` | The provider cannot do this. Carries `feature`, for example `deleteByFilter` on Pinecone serverless, `orFilter` on Vectorize, `queryEngine` on a Redis server without the query engine, or a `vecstore_` function that Supabase has no install for. |
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

### Supabase

```ts
import { createSupabaseStore } from "vecstore-sdk/supabase";
const store = createSupabaseStore({ client: createClient(url, key) });
```

Supabase Vector is pgvector inside Postgres, and this adapter reaches it through `supabase-js`, so it runs in Edge Functions and the browser. PostgREST has no syntax for `order by embedding <=> $1`, so every verb calls a SQL function. Install them once per project:

```bash
psql "$SUPABASE_DB_URL" -f node_modules/vecstore-sdk/sql/supabase.sql
```

The functions are `security invoker`, so row level security policies apply to `query`, `fetch`, `upsert`, and `delete`. `createIndex` and `deleteIndex` run DDL and need the service role key. The table layout matches the pgvector adapter, so both adapters can read the same table.

### Upstash Vector

```ts
import { Index } from "@upstash/vector";
import { createUpstashStore } from "vecstore-sdk/upstash";
const store = createUpstashStore({ client: new Index({ url, token }) });
```

One store talks to one Upstash vector index. `@upstash/vector` cannot create an index, so create it in the Upstash console first. The dimension and the similarity function are fixed there. An index name is an Upstash namespace inside it, so `createIndex` checks your spec against `info()`, `deleteIndex` deletes the namespace, and `listIndexes` returns them.

The index name already uses the one namespace Upstash gives you, so `namespaceMode` picks where the `namespace` option lives. The default, `"metadata"`, keeps it in the `_namespace` metadata key, which the adapter adds to every query and filtered delete, and stores ids as `{namespace}/{length}/{id}` with the original in `_id`. Records in the default namespace keep their id and carry neither key, and the adapter strips both keys from returned metadata.

`"native"` gives each index and namespace pair its own Upstash namespace, named `{index}` or `{index}~{namespace}`. Ids and metadata are stored as you wrote them, queries carry no namespace filter, and `delete({ all: true })` resets the namespace in one call. Upstash caps namespaces at 100 on the free plan and 10,000 on the paid plans, so choose this mode when you can name your namespaces up front. Nothing migrates between the two modes.

Upstash gives each query a filtering budget and can return fewer than `topK` records when the filter is selective. In metadata mode the adapter scopes every query by namespace, so this applies to every Upstash query. Ask for more than you need, or page with a second query.

Upstash filters are a string rather than an object, so `compileUpstashFilter` validates what it writes. It rejects a field name that breaks Upstash's identifier rule, a string value holding a backslash or both quote characters, and a non-finite number, and the verb returns an `invalid_argument` error.

### Cloudflare Vectorize

```ts
import Cloudflare from "cloudflare";
import { createVectorizeStore } from "vecstore-sdk/vectorize";

const store = createVectorizeStore({
  client: new Cloudflare({ apiToken }),
  accountId,
  metadataIndexes: [
    { property: "genre", type: "string" },
    { property: "year", type: "number" },
  ],
});
```

The adapter drives the Vectorize v2 HTTP API through the official `cloudflare` client, so an index is a real Vectorize index and `createIndex`, `deleteIndex`, and `listIndexes` all work. It needs an API token with the Vectorize permission and your account id. The Workers binding is not the client: a binding reaches one index and has no call that creates, lists, or drops one.

Vectorize filters only work on properties that carry a metadata index, and a metadata index has to exist before you insert. `metadataIndexes` opens them, and `createIndex` creates them right after the index. Vectorize allows ten per index, and you cannot add one for data already written.

Namespaces are native. The adapter sends the namespace with every vector and scopes every query to it. A Vectorize id is unique across the whole index rather than within a namespace, so the adapter hashes the id of a namespaced record to a deterministic UUID and keeps your id in the `_id` metadata key, the way the Qdrant adapter does. Records in the default namespace keep their id unless it exceeds the 64 byte Vectorize limit. The adapter strips `_id` from returned metadata.

Three things Vectorize cannot do come back as `unsupported`:

| Feature | Why |
| --- | --- |
| `delete({ filter })` | Vectorize deletes by id only. |
| `delete({ all: true })` | Vectorize has no call that empties a namespace. |
| `or(...)` and `exists(...)` | A Vectorize filter joins every clause with AND, and it has no operator for a missing property. |

Two Vectorize limits shape a query. Every result carries metadata, because that is where the original id lives, so `topK` caps at 50 rather than 100. Writes are asynchronous: an upsert returns a mutation id and the records become searchable a moment later.

### Redis

```ts
import { createClient } from "redis";
import { createRedisStore } from "vecstore-sdk/redis";

const client = createClient({ url });
await client.connect();

const store = createRedisStore({
  client,
  metadataFields: [
    { field: "genre", type: "tag" },
    { field: "year", type: "numeric" },
  ],
});
```

The adapter needs the Redis Query Engine and JSON, which ship with Redis 8, Redis Stack 7.4 or later, and Redis Cloud. A server without them returns `unsupported` with `feature: "queryEngine"`. The client is anything with the `ft`, `json`, and `unlink` calls that `node-redis` 5 or later gives you, so a cluster client works too.

An index is a real Redis index over JSON documents. `createIndex` runs `FT.CREATE ... ON JSON PREFIX 1 vecstore:{index}:`, and a record is stored at `vecstore:{index}:{namespace}:{id}` as `{ namespace, vector, metadata }`. Pass `keyPrefix` to move the keyspace, and `algorithm` to pick `"HNSW"` over the exact `"FLAT"` default. `listIndexes` returns every index in the database, because `FT._LIST` has no way to tell one owner from another.

Redis searches a metadata field only when the index schema declares it, so `metadataFields` names the fields you filter on: `tag` for strings, booleans, and string lists, `numeric` for numbers. A name must match `^[A-Za-z_][A-Za-z0-9_]*$` and cannot be `namespace`, `vector`, or `vector_distance`, which the adapter keeps for itself. A filter on any other field returns `invalid_argument` rather than the empty result Redis would give you. Redis also drops a whole document from the index when one value contradicts the schema, so `upsert` rejects such a record before it writes.

Namespaces are a tag on each document and a prefix on each key. The default namespace stores the empty tag, which is why the adapter creates every tag field with `INDEXEMPTY`, and it creates every metadata field with `INDEXMISSING` so `exists` has an operator to compile to. `delete({ filter })` and `delete({ all: true })` search the namespace and unlink the matches in pages of 500.

A score is the vector distance the metric defines, and lower is closer: `1 - cosine similarity` for `cosine`, `1 - inner product` for `dot`, and the euclidean distance for `euclidean`. Writes are synchronous, so a record is searchable as soon as `upsert` returns.

## Semantics that differ

The compilers are exact for scalar fields. Two cases differ across providers:

- Negations (`ne`, `notIn`, `not`) match records that lack the field on Qdrant, pgvector, Supabase, and Redis. Pinecone, Upstash, and Vectorize apply operators to present fields only.
- `eq` and `isIn` on array-valued fields mean "contains" on Qdrant, pgvector, Supabase, and Redis, where each element of a string list is its own tag. Pinecone supports `$in` on list fields and rejects `$eq`. Upstash compares the array itself. Reach an element with the accessors it documents, such as `eq("tags[0]", "x")`. Vectorize indexes string, number, and boolean properties only, so an array-valued field is not filterable there.

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
SUPABASE_URL=https://your_project_ref_here.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here \
UPSTASH_VECTOR_REST_URL=https://your-index.upstash.io \
UPSTASH_VECTOR_REST_TOKEN=your_upstash_token \
CLOUDFLARE_ACCOUNT_ID=your_account_id_here \
CLOUDFLARE_API_TOKEN=your_api_token_here \
REDIS_URL=redis://localhost:6379 \
bun run test:live
```

The suite skips providers without a variable. Supabase needs the SQL functions installed and the service role key, because the suite creates and drops tables. Point the Upstash variables at a scratch index with dimension 3 and the cosine similarity function, since the adapter cannot create one. The Vectorize run skips the `delete({ all: true })` case and asserts the `unsupported` error instead. Point `REDIS_URL` at a server that carries the query engine and JSON; the Redis run adds cases for the default namespace, `exists`, list fields, and delete by filter.

## Not in v0

Embedding generation, hybrid and sparse search, reranking, chunking, and an Effect integration. See [docs/design.md](../../docs/design.md) for the reasoning.

## License

MIT
