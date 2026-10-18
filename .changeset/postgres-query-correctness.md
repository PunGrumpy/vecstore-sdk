---
"vecstore-sdk": patch
---

Fix three pgvector and Supabase query defects. `not` around a range filter, such as `not(gt("year", 2000))`, now matches records that have no `year`, as the docs describe; the range comparison evaluated to SQL `NULL` for a missing field, so those records were skipped by queries and by `delete({ filter })`. A record with a zero vector, whose cosine score is NaN, now ranks last instead of first when Postgres reads an HNSW-indexed table without the index. The metric is now read from the `embedding` column's operator class only, so a table whose name contains an operator class name, such as `x_vector_cosine_ops`, keeps its own metric. Re-run `sql/supabase.sql` to get the new `vecstore_filter_sql`, `vecstore_metric`, and `vecstore_query`.
