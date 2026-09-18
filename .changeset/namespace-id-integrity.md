---
"vecstore-sdk": patch
---

Close three gaps in the namespace emulation the Qdrant, Cloudflare Vectorize, and Upstash metadata-mode adapters share.

A default-namespace handle could reach a record that belongs to another namespace through an id. Qdrant `delete({ ids })` now sends the `_namespace` condition next to a `has_id` condition instead of a bare point list, and Qdrant `fetch` drops a point whose payload reports a different namespace. Vectorize and Upstash read a default-namespace delete back before they send it and remove only the ids whose stored record reports no namespace. A handle with a namespace is unchanged, and Upstash native mode, which has real namespaces, keeps its single call.

The three adapters join the namespace and the id with a slash when they build a stored id, and the join is ambiguous: namespace `a` with id `1/b` and namespace `a/3` with id `b` produce the same string. `upsert`, `query`, `fetch`, and `delete` now return `invalid_argument` for a namespace that contains a slash rather than letting two tenants collide on one stored id.

`upsert` also returns `invalid_argument` for a record whose metadata sets a key the adapter keeps for itself, `_id` or `_namespace`, which previously let a caller decide the id a record reads back under.
