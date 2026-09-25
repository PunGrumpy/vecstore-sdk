---
"vecstore-sdk": patch
---

Match array-valued metadata the way the docs describe on pgvector and Supabase. `eq("tags", "x")` and `isIn("tags", ["x"])` compiled to a jsonb containment that never matches a list, so a record with `tags: ["x", "y"]` was invisible to both, and `isIn` on a list field meant "the list is a subset of the values", which nothing documented. Both compilers, the TypeScript one and `vecstore_filter_sql`, now emit `metadata @> '{"tags":"x"}' OR metadata @> '{"tags":["x"]}'` per value, which the GIN index serves, and `ne` and `notIn` are the exact negations, so they still match records that lack the field. Re-run `sql/supabase.sql` to pick up the new `vecstore_filter_sql` and its helper `vecstore_contains_any`. Qdrant `notIn` now compiles to `must_not` of `match.any`, the same filter `not(isIn(...))` produces, instead of `match.except`, which matched a list as soon as one element fell outside the values.
