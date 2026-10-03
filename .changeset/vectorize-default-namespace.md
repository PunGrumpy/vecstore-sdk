---
"vecstore-sdk": patch
---

Keep a Cloudflare Vectorize query in the default namespace from returning records that belong to another namespace. Vectorize searches the whole index when a query names no namespace, and the adapter sends none for the default namespace. So `store.index("docs").query(…)` could return a record written through `store.index("docs", { namespace: "tenant-a" })`, with its metadata and original id. `query` now drops matches that report a namespace other than the handle's, the way `fetch` and `delete` already do. A default-namespace query on an index that also holds namespaced records can return fewer than `topK` records.
