---
"vecstore-sdk": patch
---

Add a Cloudflare Vectorize adapter at `vecstore-sdk/vectorize`.

`createVectorizeStore` takes a `Cloudflare` client from the `cloudflare` package, which is now an optional peer dependency, plus your `accountId`. It drives the Vectorize v2 HTTP API, so an index is a real Vectorize index and `createIndex`, `deleteIndex`, and `listIndexes` all work. The Workers binding is not the client, because a binding reaches one index and has no call that creates, lists, or drops one. A Vectorize filter only matches on a property that carries a metadata index, and a metadata index has to exist before you insert, so `metadataIndexes` names the properties you filter on and `createIndex` opens them.

Namespaces are native, and the adapter scopes every write and every query to them. A Vectorize id is unique across the whole index rather than within a namespace and is capped at 64 bytes, so a namespaced record, or one with an id that is too long, is stored under a deterministic UUID with the original id in the `_id` metadata key, the way the Qdrant adapter does it.

`compileVectorizeFilter` compiles the filter AST to a Vectorize filter object. It is the one compiler that returns a `Result`, because a Vectorize filter joins every field with AND and has no operator for a missing property. `not` is pushed to the leaves with De Morgan's laws, and what is left over comes back as an `unsupported` error with `feature: "orFilter"` or `"existsFilter"` before the request is sent. `delete({ filter })` and `delete({ all: true })` are `unsupported` too, because Vectorize deletes by id only.
