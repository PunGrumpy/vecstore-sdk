---
"vecstore-sdk": patch
---

Hold less memory during a large `upsert` on Qdrant, Upstash Vector, and Cloudflare Vectorize. These adapters converted every record into the provider's request shape before sending the first batch, so the converted copy of the whole input stayed alive until the last batch finished. They now convert each batch as it is sent, as the pgvector, Supabase, and Pinecone adapters already did. With 5,000 records of 1,536 dimensions, the memory still reachable while requests ran dropped from about 140 MB to about 1 MB on Vectorize and from about 60 MB to under 10 MB on Qdrant and Upstash. Requests and their order are unchanged.
