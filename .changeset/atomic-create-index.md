---
"vecstore-sdk": patch
---

Make `createIndex` all-or-nothing on the pgvector, Qdrant, and Cloudflare Vectorize adapters. Each one runs several provider calls in sequence, and a failure partway through used to leave the earlier calls standing, so the caller got an error and a half-built index that reported `already_exists` on the retry.

The pgvector adapter sends `CREATE EXTENSION`, `CREATE TABLE`, and the two `CREATE INDEX` statements as one `DO` block, which the server runs in a single implicit transaction. The HNSW index caps a `vector` column at 2000 dimensions, so a 3072-dimension index used to leave a table with no vector index on it and every later `query` fell back to an exact scan. Nothing changes for `PgQueryable`, so a `pg` Pool, a `pg` Client, and postgres.js through `sql.unsafe` all keep working.

The Qdrant adapter deletes the collection it just created when the `_namespace` tenant index fails, and the Vectorize adapter deletes the index it just created when a metadata index fails. Both return the original error rather than whatever the cleanup call reports.
