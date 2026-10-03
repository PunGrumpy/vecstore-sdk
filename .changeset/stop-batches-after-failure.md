---
"vecstore-sdk": patch
---

Stop sending batches once one has failed. A large `upsert` or `delete({ ids })` runs four requests at a time. When one failed, the call returned its error while the other workers went on sending every remaining batch in the background, so a retry ran alongside the first call's remaining requests. Now no further batch starts after a failure, and the call returns once the requests already in flight have finished. Supabase `fetch` sends ids 500 per request: PostgREST caps the rows a function returns (1,000 by default on Supabase) and truncates without an error, so a larger `fetch` lost records. Upstash `deleteIndex` deletes an index's namespaces four at a time instead of all at once. The `@upstash/vector` peer range starts at 1.2.1, the first version whose `delete` accepts `{ ids }` and `{ filter }`. Version 1.2.0 satisfied the old range and could not delete.
