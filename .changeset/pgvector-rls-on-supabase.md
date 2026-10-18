---
"vecstore-sdk": patch
---

Turn on row level security for a table that the pgvector adapter's `createIndex` makes when the database has an `anon` role, as every Supabase project does. Before this, a table created through `createPgvectorStore` on a Supabase database sat in `public` with row level security off, so anyone holding the project's anon key could read, change, and delete its records through the REST API. The role that runs `createIndex` owns the table and keeps full access. Plain Postgres without an `anon` role is unchanged. Tables created by earlier versions are not altered; turn it on with `alter table "<name>" enable row level security;`.
