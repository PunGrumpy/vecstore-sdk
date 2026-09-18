---
"vecstore-sdk": patch
---

Align six contract edges where one adapter answered a call differently from the rest.

Qdrant `deleteIndex` returns `not_found` for a collection the server does not hold. The client returns the server's boolean and the adapter used to discard it, so deleting a name that never existed came back `ok` while the other six adapters report `not_found`.

`createIndex` rejects a `dimension` that is not a positive integer on every adapter, with the message pgvector and Supabase already used. The check used to live on those two only, so `dimension: 0` was a clean `invalid_argument` on two providers and a provider-shaped error on the rest, and Redis went as far as sending `FT.CREATE` with `DIM 0`. The check in `sql/supabase.sql` stays where it is.

Pinecone `query` honors `includeMetadata` and `includeVector` on the records it returns. The adapter used to forward both flags and return whatever came back, and Pinecone answers with `values: []` rather than leaving the field out, so a `ScoredRecord` from Pinecone had a different shape than one from the other six adapters.

An upsert batch that repeats an id keeps the last record on pgvector and Supabase. Postgres refuses an `INSERT ... ON CONFLICT DO UPDATE` that names the same key twice in one statement, so such a batch used to come back as a `provider` error where the other five adapters accepted it.

Supabase reports a `TypeError` that is not a failed fetch as a `provider` error. Every `TypeError` used to count as a connection failure, so a bug in the adapter or in `supabase-js` reached the caller as `kind: "connection"` and a retry policy kept retrying a call that can never succeed.

Redis delete by filter unlinks only keys under the index prefix, and an index name holding a `:` is now rejected with `invalid_argument` on `createIndex` and on every verb. `FT.SEARCH` scopes on the namespace field rather than on the key prefix, so an index named `docs` and one named `docs:v2` shared a keyspace and a delete in the first took the second one's documents with it. If you already run an index whose name holds a colon, rename it before you upgrade.
