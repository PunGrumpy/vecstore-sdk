---
"vecstore-sdk": minor
---

Add `scan`, which pages through every record in an index's namespace on all seven adapters: `const page = await index.scan({ cursor, limit, includeVector })` returns up to `limit` records and a `cursor` for the next call, `undefined` once the scan is done. Records come back with the ids you wrote, including on Qdrant, Vectorize, and Upstash, where the provider stores a hashed or prefixed id. A page can be short or empty while `cursor` is set. Pinecone supports it on serverless indexes only. Supabase users re-run `sql/supabase.sql` to install `vecstore_scan`. `VectorIndex` and the `QdrantClientLike`, `PineconeIndexLike`, `UpstashIndexLike`, and `RedisClientLike` types gain a required member, so code that implements them by hand needs the new method.
