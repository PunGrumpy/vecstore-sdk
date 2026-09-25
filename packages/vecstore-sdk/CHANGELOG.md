# vecstore-sdk

## 0.1.3

### Patch Changes

- 14b3025: Match array-valued metadata the way the docs describe on pgvector and Supabase. `eq("tags", "x")` and `isIn("tags", ["x"])` compiled to a jsonb containment that never matches a list, so a record with `tags: ["x", "y"]` was invisible to both, and `isIn` on a list field meant "the list is a subset of the values", which nothing documented. Both compilers, the TypeScript one and `vecstore_filter_sql`, now emit `metadata @> '{"tags":"x"}' OR metadata @> '{"tags":["x"]}'` per value, which the GIN index serves, and `ne` and `notIn` are the exact negations, so they still match records that lack the field. Re-run `sql/supabase.sql` to pick up the new `vecstore_filter_sql` and its helper `vecstore_contains_any`. Qdrant `notIn` now compiles to `must_not` of `match.any`, the same filter `not(isIn(...))` produces, instead of `match.except`, which matched a list as soon as one element fell outside the values.
- 76fb14d: Send batched provider calls four at a time instead of all at once. A 100k-record upsert used to open every chunk in one burst, which met rate limits on Pinecone, Upstash, and Supabase and took every connection of a `pg` Pool. An upsert that repeats an id now keeps the last record on Qdrant, Pinecone, Upstash, and Vectorize too; before, copies in different chunks raced. Pinecone `delete({ ids })` is chunked at 1,000, Redis `fetch` splits `JSON.MGET` at 500, and Redis delete-by-filter stops paging when a page unlinks nothing. Every adapter's `query` returns `invalid_argument` for a `topK` that is not a positive integer.
- 0f0c636: Forget the cached pgvector metric when `createIndex` or `deleteIndex` touches a table, so a store that dropped and recreated an index with another metric, or queried before the table existed, no longer orders and scores with the stale one. Reject Postgres index names over 49 bytes on pgvector and Supabase with `invalid_argument`. Postgres truncates identifiers at 63 bytes, and the `_embedding_idx` suffix made long names collide with their own indexes or vanish from the metric lookup. The pgvector `createIndex` statement now uses a tagged dollar quote, so a name holding `$$` fails with a clear error instead of an unterminated statement. Re-run `sql/supabase.sql` to install the length check.
- 0a33d23: Harden `sql/supabase.sql`. `vecstore_create_index` now enables row level security on the table it creates, so the `anon` and `authenticated` roles read and write nothing until you add a policy; the service role bypasses it as before. Tables created by earlier versions are unchanged: run `alter table "docs" enable row level security` on them. The script also revokes `vecstore_create_index` and `vecstore_drop_index` from `anon` and `authenticated` on Supabase, and `vecstore_filter_sql` rejects a filter leaf with a missing or non-numeric value with `invalid_argument` instead of dropping the clause, which could widen a delete. Re-run `sql/supabase.sql` to pick these up.
- 85b28f3: Ship the MIT LICENSE inside the npm tarball, and require `@pinecone-database/pinecone` 7 or later, the first version with the object-parameter `upsert`, `fetch`, `query`, and `deleteMany` calls the adapter uses. Version 6 satisfied the old peer range and failed at runtime.
- 52967ed: Close the last paths where a write in the default namespace could replace a record in another namespace. On Upstash in metadata mode, a default-namespace `upsert` whose id has the `{namespace}/{length}/{id}` shape of a stored namespaced record now returns `invalid_argument`; before, `docs/3/abc` overwrote record `abc` in namespace `docs` and moved it to the default namespace. On Qdrant and Vectorize, a raw default-namespace id that is a version 8 UUID, the version the adapter's hashed ids use, is now hashed like every other id, so no raw id can equal another record's stored id. A version 8 UUID written as a raw id by an earlier version has to be re-upserted. Vectorize `fetch` from a namespaced handle now drops a vector that reports no namespace, the way the Qdrant adapter already did.

## 0.1.2

### Patch Changes

- f245c79: Make `createIndex` all-or-nothing on the pgvector, Qdrant, and Cloudflare Vectorize adapters. Each one runs several provider calls in sequence, and a failure partway through used to leave the earlier calls standing, so the caller got an error and a half-built index that reported `already_exists` on the retry.

  The pgvector adapter sends `CREATE EXTENSION`, `CREATE TABLE`, and the two `CREATE INDEX` statements as one `DO` block, which the server runs in a single implicit transaction. The HNSW index caps a `vector` column at 2000 dimensions, so a 3072-dimension index used to leave a table with no vector index on it and every later `query` fell back to an exact scan. Nothing changes for `PgQueryable`, so a `pg` Pool, a `pg` Client, and postgres.js through `sql.unsafe` all keep working.

  The Qdrant adapter deletes the collection it just created when the `_namespace` tenant index fails, and the Vectorize adapter deletes the index it just created when a metadata index fails. Both return the original error rather than whatever the cleanup call reports.

- 6fc74f0: Batch the Qdrant and Redis writes the way the other adapters already do, and cache the pgvector distance metric on the store.

  Qdrant used to put the whole list in one request. Ten thousand records of 1536 dimensions is a body far past the 32 MB the REST API accepts by default, so the call failed where the other adapters split the work. `upsert` now goes out 500 points at a time, and `fetch` and `delete({ ids })` chunk their point ids at 1000 per request.

  Redis used to issue one `JSON.SET` per record with nothing holding the fan-out back, and `delete({ ids })` handed the whole key list to a single `UNLINK`. Writes now run 500 records at a time, one batch after the previous one resolves, and the unlink keys are chunked the same way.

  A large `upsert` is now several provider requests, so a failure can leave some of the records written. Retry the whole call: an upsert replaces by id.

  The pgvector adapter read the distance metric from `pg_indexes` once per index handle, so `store.index("docs").query(...)`, the idiom the docs teach, paid a catalog round trip before every search. The cache now lives on the store, keyed by schema and table, and holds the in-flight promise, so concurrent first queries share one lookup. A lookup that fails is retried on the next query.

- 9835cfc: Align six contract edges where one adapter answered a call differently from the rest.

  Qdrant `deleteIndex` returns `not_found` for a collection the server does not hold. The client returns the server's boolean and the adapter used to discard it, so deleting a name that never existed came back `ok` while the other six adapters report `not_found`.

  `createIndex` rejects a `dimension` that is not a positive integer on every adapter, with the message pgvector and Supabase already used. The check used to live on those two only, so `dimension: 0` was a clean `invalid_argument` on two providers and a provider-shaped error on the rest, and Redis went as far as sending `FT.CREATE` with `DIM 0`. The check in `sql/supabase.sql` stays where it is.

  Pinecone `query` honors `includeMetadata` and `includeVector` on the records it returns. The adapter used to forward both flags and return whatever came back, and Pinecone answers with `values: []` rather than leaving the field out, so a `ScoredRecord` from Pinecone had a different shape than one from the other six adapters.

  An upsert batch that repeats an id keeps the last record on pgvector and Supabase. Postgres refuses an `INSERT ... ON CONFLICT DO UPDATE` that names the same key twice in one statement, so such a batch used to come back as a `provider` error where the other five adapters accepted it.

  Supabase reports a `TypeError` that is not a failed fetch as a `provider` error. Every `TypeError` used to count as a connection failure, so a bug in the adapter or in `supabase-js` reached the caller as `kind: "connection"` and a retry policy kept retrying a call that can never succeed.

  Redis delete by filter unlinks only keys under the index prefix, and an index name holding a `:` is now rejected with `invalid_argument` on `createIndex` and on every verb. `FT.SEARCH` scopes on the namespace field rather than on the key prefix, so an index named `docs` and one named `docs:v2` shared a keyspace and a delete in the first took the second one's documents with it. If you already run an index whose name holds a colon, rename it before you upgrade.

- 507195c: Close three gaps in the namespace emulation the Qdrant, Cloudflare Vectorize, and Upstash metadata-mode adapters share.

  A default-namespace handle could reach a record that belongs to another namespace through an id. Qdrant `delete({ ids })` now sends the `_namespace` condition next to a `has_id` condition instead of a bare point list, and Qdrant `fetch` drops a point whose payload reports a different namespace. Vectorize and Upstash read a default-namespace delete back before they send it and remove only the ids whose stored record reports no namespace. A handle with a namespace is unchanged, and Upstash native mode, which has real namespaces, keeps its single call.

  The three adapters join the namespace and the id with a slash when they build a stored id, and the join is ambiguous: namespace `a` with id `1/b` and namespace `a/3` with id `b` produce the same string. `upsert`, `query`, `fetch`, and `delete` now return `invalid_argument` for a namespace that contains a slash rather than letting two tenants collide on one stored id.

  `upsert` also returns `invalid_argument` for a record whose metadata sets a key the adapter keeps for itself, `_id` or `_namespace`, which previously let a caller decide the id a record reads back under.

## 0.1.1

### Patch Changes

- b19b2b8: Add a Cloudflare Vectorize adapter at `vecstore-sdk/vectorize`.

  `createVectorizeStore` takes a `Cloudflare` client from the `cloudflare` package, which is now an optional peer dependency, plus your `accountId`. It drives the Vectorize v2 HTTP API, so an index is a real Vectorize index and `createIndex`, `deleteIndex`, and `listIndexes` all work. The Workers binding is not the client, because a binding reaches one index and has no call that creates, lists, or drops one. A Vectorize filter only matches on a property that carries a metadata index, and a metadata index has to exist before you insert, so `metadataIndexes` names the properties you filter on and `createIndex` opens them.

  Namespaces are native, and the adapter scopes every write and every query to them. A Vectorize id is unique across the whole index rather than within a namespace and is capped at 64 bytes, so a namespaced record, or one with an id that is too long, is stored under a deterministic UUID with the original id in the `_id` metadata key, the way the Qdrant adapter does it.

  `compileVectorizeFilter` compiles the filter AST to a Vectorize filter object. It is the one compiler that returns a `Result`, because a Vectorize filter joins every field with AND and has no operator for a missing property. `not` is pushed to the leaves with De Morgan's laws, and what is left over comes back as an `unsupported` error with `feature: "orFilter"` or `"existsFilter"` before the request is sent. `delete({ filter })` and `delete({ all: true })` are `unsupported` too, because Vectorize deletes by id only.

- 12f7509: Add the Supabase adapter. `createSupabaseStore` from `vecstore-sdk/supabase` reaches Supabase Vector through `supabase-js`, so vector search runs in Edge Functions and the browser. PostgREST has no syntax for `order by embedding <=> $1`, so every verb calls a SQL function from the new `sql/supabase.sql`, which you install once per project. The functions are `security invoker`, so row level security still applies, and filters cross as JSON rather than SQL text. The table layout matches the pgvector adapter, so both adapters can read the same table.
- bb85fb9: Add a Redis adapter at `vecstore-sdk/redis`.

  `createRedisStore` takes a client with the `ft`, `json`, and `unlink` calls that `node-redis` gives you, which is now an optional peer dependency, and drives the Redis Query Engine over JSON documents. An index is a real Redis index: `createIndex` runs `FT.CREATE ... ON JSON PREFIX 1 vecstore:{index}:`, a record is stored at `vecstore:{index}:{namespace}:{id}` as `{ namespace, vector, metadata }`, and `deleteIndex` drops the index and its documents. The server needs the query engine and JSON, which ship with Redis 8, Redis Stack 7.4 or later, and Redis Cloud; without them every verb returns `unsupported` with `feature: "queryEngine"`.

  Records are JSON rather than hashes, so metadata keeps its types, a string list indexes one tag per element, and a vector reads back at full precision while the index holds a `FLOAT32` copy. Ids live in the key rather than in a reserved metadata field, so nothing is hidden from what you read back. Namespaces are a tag on the document and a segment in the key, and the default namespace stores the empty tag, which is why every tag field carries `INDEXEMPTY`.

  Redis searches a metadata field only when the index schema declares it, so `metadataFields` names the fields you filter on as `tag` or `numeric`, and `createIndex` adds one schema entry each. `compileRedisFilter` takes that same list and returns a `Result`, so a filter on an undeclared field, or one that compares a number against a tag field, comes back as `invalid_argument` instead of the empty page Redis would answer with. `upsert` runs the same check, because Redis leaves a whole document out of the index when one value contradicts the schema. Every metadata field carries `INDEXMISSING`, which gives `exists` an operator to compile to.

  A Redis score is the vector distance, where lower is closer for every metric, unlike the higher-is-better score the other adapters return for `cosine` and `dot`.

- 12f7509: Add an Upstash Vector adapter at `vecstore-sdk/upstash`.

  `createUpstashStore` wraps an `Index` from `@upstash/vector`, which is now an optional peer dependency. `@upstash/vector` cannot create a vector index, so an index name is an Upstash namespace inside the index your URL and token point at: `createIndex` checks the dimension and metric against `info()`, `deleteIndex` deletes the namespace, and `listIndexes` returns them. The index name uses the one namespace level Upstash gives you, so `namespaceMode` picks where the `namespace` option lives. The default, `"metadata"`, emulates it with a `_namespace` metadata key and a namespace-prefixed stored id, keeping the original id in `_id`. `"native"` gives each index and namespace pair its own Upstash namespace named `{index}~{namespace}`, which leaves ids and metadata untouched and queries unfiltered, at the cost of Upstash's namespace cap.

  `compileUpstashFilter` compiles the filter AST to the Upstash filter string. Upstash has no `NOT`, so the compiler pushes negation to the leaves with De Morgan's laws. Because the filter is a string, the compiler rejects a field name that breaks Upstash's identifier rule, a string value holding a backslash or both quote characters, and a non-finite number. The verb returns an `invalid_argument` error instead.

## 0.1.0

### Minor Changes

- 0ae2949: Initial release: filter AST with Qdrant, pgvector, and Pinecone compilers, the core vector store API, normalized errors, and adapters for all three providers.
