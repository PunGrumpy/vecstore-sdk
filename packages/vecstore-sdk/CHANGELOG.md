# vecstore-sdk

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
