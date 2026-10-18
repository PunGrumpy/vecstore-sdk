---
"vecstore-sdk": patch
---

Keep Upstash namespaces apart on `fetch` in metadata mode. A default-namespace handle that fetched an id shaped `{namespace}/{length}/{id}` received that namespace's record, relabelled with the plain id, in place of its own. `fetch` now returns only records of the handle's namespace. Every verb also returns `invalid_argument` up front for a metadata-mode namespace holding a backslash or both quote characters, which `upsert` used to accept although no query or filtered delete could reach it afterwards, and for an index name of `.` or `..`, which the request URL would have collapsed.
