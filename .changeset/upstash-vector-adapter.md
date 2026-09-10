---
"vecstore-sdk": patch
---

Add an Upstash Vector adapter at `vecstore-sdk/upstash`.

`createUpstashStore` wraps an `Index` from `@upstash/vector`, which is now an optional peer dependency. `@upstash/vector` cannot create a vector index, so an index name is an Upstash namespace inside the index your URL and token point at: `createIndex` checks the dimension and metric against `info()`, `deleteIndex` deletes the namespace, and `listIndexes` returns them. The index name uses the one namespace level Upstash gives you, so `namespaceMode` picks where the `namespace` option lives. The default, `"metadata"`, emulates it with a `_namespace` metadata key and a namespace-prefixed stored id, keeping the original id in `_id`. `"native"` gives each index and namespace pair its own Upstash namespace named `{index}~{namespace}`, which leaves ids and metadata untouched and queries unfiltered, at the cost of Upstash's namespace cap.

`compileUpstashFilter` compiles the filter AST to the Upstash filter string. Upstash has no `NOT`, so the compiler pushes negation to the leaves with De Morgan's laws. Because the filter is a string, the compiler rejects a field name that breaks Upstash's identifier rule, a string value holding a backslash or both quote characters, and a non-finite number. The verb returns an `invalid_argument` error instead.
