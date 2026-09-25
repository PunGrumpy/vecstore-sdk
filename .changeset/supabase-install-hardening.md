---
"vecstore-sdk": patch
---

Harden `sql/supabase.sql`. `vecstore_create_index` now enables row level security on the table it creates, so the `anon` and `authenticated` roles read and write nothing until you add a policy; the service role bypasses it as before. Tables created by earlier versions are unchanged: run `alter table "docs" enable row level security` on them. The script also revokes `vecstore_create_index` and `vecstore_drop_index` from `anon` and `authenticated` on Supabase, and `vecstore_filter_sql` rejects a filter leaf with a missing or non-numeric value with `invalid_argument` instead of dropping the clause, which could widen a delete. Re-run `sql/supabase.sql` to pick these up.
