---
"vecstore-sdk": patch
---

Reject a vector that cannot be stored before any adapter writes it. `fetch` returns `vector: []` unless you pass `{ includeVector: true }`, and it returns the same `VectorRecord` type that `upsert` takes, so fetching a record, changing its metadata, and upserting it typechecked. On Redis that call returned `ok` and stored a document with an empty vector, which the search index leaves out of every query; the other adapters passed the empty vector on to the provider. Every adapter's `upsert` now returns `invalid_argument` and writes nothing when a vector is empty, holds `NaN` or an infinite value, or has a different length from the first record in the call. `query` returns `invalid_argument` for an empty or non-finite query vector.
