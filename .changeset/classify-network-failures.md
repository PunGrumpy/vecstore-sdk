---
"vecstore-sdk": patch
---

Report network failures as `{ kind: "connection" }` on Bun as well as Node. Bun's `fetch` puts the error code on the error itself instead of on `cause`, so an unreachable host came back as `provider` from the Qdrant, Upstash, and Supabase adapters under Bun. The adapters now recognise both shapes, and the Supabase adapter treats a response with status 0 (no HTTP response) as a connection failure, including a timed-out request. The pgvector adapter also maps node-postgres's code-less timeouts and dropped connections to `connection`, and both Postgres adapters map the SQLSTATEs 57P02, 57P03, and 53300 to it. `SupabaseRpcResponse` gains an optional `status` field.
