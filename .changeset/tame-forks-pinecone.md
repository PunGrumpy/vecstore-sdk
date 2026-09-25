---
"vecstore-sdk": patch
---

Ship the MIT LICENSE inside the npm tarball, and require `@pinecone-database/pinecone` 7 or later, the first version with the object-parameter `upsert`, `fetch`, `query`, and `deleteMany` calls the adapter uses. Version 6 satisfied the old peer range and failed at runtime.
