---
"vecstore-sdk": patch
---

Return `topK` records from pgvector and Supabase queries once Postgres uses the HNSW index. pgvector applies the namespace and the filter after the index scan, and a scan stops at `hnsw.ef_search` candidates (40 by default), so a `topK` above 40, a selective filter, or a namespace holding part of the table returned fewer records with no error. On pgvector 0.8.0 or later both adapters now turn on an iterative scan (`hnsw.iterative_scan`) for the one statement. They keep a value you set yourself, and older versions keep the previous statement. Re-run `sql/supabase.sql` to get the new `vecstore_query`. The pgvector store also forgets its cached metric when a query fails, so a store that queried a table before another process created it no longer keeps the cosine fallback. The header of `sql/supabase.sql` now shows the `psql` command instead of a Supabase CLI command that does not exist.
