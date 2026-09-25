---
"vecstore-sdk": patch
---

Close the last paths where a write in the default namespace could replace a record in another namespace. On Upstash in metadata mode, a default-namespace `upsert` whose id has the `{namespace}/{length}/{id}` shape of a stored namespaced record now returns `invalid_argument`; before, `docs/3/abc` overwrote record `abc` in namespace `docs` and moved it to the default namespace. On Qdrant and Vectorize, a raw default-namespace id that is a version 8 UUID, the version the adapter's hashed ids use, is now hashed like every other id, so no raw id can equal another record's stored id. A version 8 UUID written as a raw id by an earlier version has to be re-upserted. Vectorize `fetch` from a namespaced handle now drops a vector that reports no namespace, the way the Qdrant adapter already did.
