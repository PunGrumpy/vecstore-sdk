---
"vecstore-sdk": patch
---

Forget the cached pgvector metric when `createIndex` or `deleteIndex` touches a table, so a store that dropped and recreated an index with another metric, or queried before the table existed, no longer orders and scores with the stale one. Reject Postgres index names over 49 bytes on pgvector and Supabase with `invalid_argument`. Postgres truncates identifiers at 63 bytes, and the `_embedding_idx` suffix made long names collide with their own indexes or vanish from the metric lookup. The pgvector `createIndex` statement now uses a tagged dollar quote, so a name holding `$$` fails with a clear error instead of an unterminated statement. Re-run `sql/supabase.sql` to install the length check.
