# vecstore-sdk

## 0.2.0

### Minor Changes

- 77ab9b0: Add the Supabase adapter. `createSupabaseStore` from `vecstore-sdk/supabase` reaches Supabase Vector through `supabase-js`, so vector search runs in Edge Functions and the browser. PostgREST has no syntax for `order by embedding <=> $1`, so every verb calls a SQL function from the new `sql/supabase.sql`, which you install once per project. The functions are `security invoker`, so row level security still applies, and filters cross as JSON rather than SQL text. The table layout matches the pgvector adapter, so both adapters can read the same table.

### Patch Changes

- 64a7d1a: Add an Upstash Vector adapter at `vecstore-sdk/upstash`.

  `createUpstashStore` wraps an `Index` from `@upstash/vector`, which is now an optional peer dependency. `@upstash/vector` cannot create a vector index, so an index name is an Upstash namespace inside the index your URL and token point at: `createIndex` checks the dimension and metric against `info()`, `deleteIndex` deletes the namespace, and `listIndexes` returns them. The index name uses the one namespace level Upstash gives you, so `namespaceMode` picks where the `namespace` option lives. The default, `"metadata"`, emulates it with a `_namespace` metadata key and a namespace-prefixed stored id, keeping the original id in `_id`. `"native"` gives each index and namespace pair its own Upstash namespace named `{index}~{namespace}`, which leaves ids and metadata untouched and queries unfiltered, at the cost of Upstash's namespace cap.

  `compileUpstashFilter` compiles the filter AST to the Upstash filter string. Upstash has no `NOT`, so the compiler pushes negation to the leaves with De Morgan's laws. Because the filter is a string, the compiler rejects a field name that breaks Upstash's identifier rule, a string value holding a backslash or both quote characters, and a non-finite number. The verb returns an `invalid_argument` error instead.

## 0.1.0

### Minor Changes

- 0ae2949: Initial release: filter AST with Qdrant, pgvector, and Pinecone compilers, the core vector store API, normalized errors, and adapters for all three providers.
