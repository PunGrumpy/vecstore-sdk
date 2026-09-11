---
"vecstore-sdk": patch
---

Add a Redis adapter at `vecstore-sdk/redis`.

`createRedisStore` takes a client with the `ft`, `json`, and `unlink` calls that `node-redis` gives you, which is now an optional peer dependency, and drives the Redis Query Engine over JSON documents. An index is a real Redis index: `createIndex` runs `FT.CREATE ... ON JSON PREFIX 1 vecstore:{index}:`, a record is stored at `vecstore:{index}:{namespace}:{id}` as `{ namespace, vector, metadata }`, and `deleteIndex` drops the index and its documents. The server needs the query engine and JSON, which ship with Redis 8, Redis Stack 7.4 or later, and Redis Cloud; without them every verb returns `unsupported` with `feature: "queryEngine"`.

Records are JSON rather than hashes, so metadata keeps its types, a string list indexes one tag per element, and a vector reads back at full precision while the index holds a `FLOAT32` copy. Ids live in the key rather than in a reserved metadata field, so nothing is hidden from what you read back. Namespaces are a tag on the document and a segment in the key, and the default namespace stores the empty tag, which is why every tag field carries `INDEXEMPTY`.

Redis searches a metadata field only when the index schema declares it, so `metadataFields` names the fields you filter on as `tag` or `numeric`, and `createIndex` adds one schema entry each. `compileRedisFilter` takes that same list and returns a `Result`, so a filter on an undeclared field, or one that compares a number against a tag field, comes back as `invalid_argument` instead of the empty page Redis would answer with. `upsert` runs the same check, because Redis leaves a whole document out of the index when one value contradicts the schema. Every metadata field carries `INDEXMISSING`, which gives `exists` an operator to compile to.

A Redis score is the vector distance, where lower is closer for every metric, unlike the higher-is-better score the other adapters return for `cosine` and `dot`.
