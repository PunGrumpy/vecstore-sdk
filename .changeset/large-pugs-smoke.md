---
"vecstore-sdk": patch
---

Add the Supabase adapter. `createSupabaseStore` from `vecstore-sdk/supabase` reaches Supabase Vector through `supabase-js`, so vector search runs in Edge Functions and the browser. PostgREST has no syntax for `order by embedding <=> $1`, so every verb calls a SQL function from the new `sql/supabase.sql`, which you install once per project. The functions are `security invoker`, so row level security still applies, and filters cross as JSON rather than SQL text. The table layout matches the pgvector adapter, so both adapters can read the same table.
