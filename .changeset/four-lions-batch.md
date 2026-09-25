---
"vecstore-sdk": patch
---

Send batched provider calls four at a time instead of all at once. A 100k-record upsert used to open every chunk in one burst, which met rate limits on Pinecone, Upstash, and Supabase and took every connection of a `pg` Pool. An upsert that repeats an id now keeps the last record on Qdrant, Pinecone, Upstash, and Vectorize too; before, copies in different chunks raced. Pinecone `delete({ ids })` is chunked at 1,000, Redis `fetch` splits `JSON.MGET` at 500, and Redis delete-by-filter stops paging when a page unlinks nothing. Every adapter's `query` returns `invalid_argument` for a `topK` that is not a positive integer.
