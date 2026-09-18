---
"vecstore-sdk": patch
---

Batch the Qdrant and Redis writes the way the other adapters already do, and cache the pgvector distance metric on the store.

Qdrant used to put the whole list in one request. Ten thousand records of 1536 dimensions is a body far past the 32 MB the REST API accepts by default, so the call failed where the other adapters split the work. `upsert` now goes out 500 points at a time, and `fetch` and `delete({ ids })` chunk their point ids at 1000 per request.

Redis used to issue one `JSON.SET` per record with nothing holding the fan-out back, and `delete({ ids })` handed the whole key list to a single `UNLINK`. Writes now run 500 records at a time, one batch after the previous one resolves, and the unlink keys are chunked the same way.

A large `upsert` is now several provider requests, so a failure can leave some of the records written. Retry the whole call: an upsert replaces by id.

The pgvector adapter read the distance metric from `pg_indexes` once per index handle, so `store.index("docs").query(...)`, the idiom the docs teach, paid a catalog round trip before every search. The cache now lives on the store, keyed by schema and table, and holds the in-flight promise, so concurrent first queries share one lookup. A lookup that fails is retried on the next query.
