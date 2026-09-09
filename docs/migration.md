# Move between providers

This guide covers what changes when you move an application from one adapter to another. The verbs, filters, and result types stay the same. What changes is the client you construct, how each provider stores ids and namespaces, and a few filter edge cases.

## Swap the adapter

Replace the client and the `create*Store` import. Nothing else in your code refers to the provider.

```ts
import { Pinecone } from "@pinecone-database/pinecone";
import { createPineconeStore } from "vecstore-sdk/pinecone";

const store = createPineconeStore({ client: new Pinecone({ apiKey }) });
```

```ts
import { QdrantClient } from "@qdrant/js-client-rest";
import { createQdrantStore } from "vecstore-sdk/qdrant";

const store = createQdrantStore({ client: new QdrantClient({ url }) });
```

```ts
import { Pool } from "pg";
import { createPgvectorStore } from "vecstore-sdk/pgvector";

const store = createPgvectorStore({ client: new Pool({ connectionString }) });
```

## Copy the data

The SDK does not move records for you. Read from the old index with `fetch` or your own export, then `upsert` into the new one. The adapter batches upserts, so pass as many records per call as fit in memory.

Record ids, vectors, and metadata round-trip unchanged. Every provider accepts only `string`, `number`, `boolean`, and `string[]` metadata values, so a record that upserts on one provider upserts on all of them.

## What each provider stores

| Concern | Qdrant | pgvector | Pinecone |
| --- | --- | --- | --- |
| Index | Collection | Table | Index |
| Namespace | `_namespace` payload key | `namespace` column | Native |
| Id | UUID, hashed from your id when needed, original kept in `_id` | `id text` | Native |
| Metadata | Payload | `metadata jsonb` | Metadata |
| Metric | Set on the collection | Read from the HNSW index opclass | Set on the index |

If you read a Qdrant collection or a pgvector table with another tool, expect those extra keys and columns.

## Scores

Scores are the provider's native score for the index metric:

| Metric | Qdrant | pgvector | Pinecone |
| --- | --- | --- | --- |
| `cosine` | Similarity, higher is better | `1 - distance`, higher is better | Similarity, higher is better |
| `dot` | Dot product, higher is better | Dot product, higher is better | Dot product, higher is better |
| `euclidean` | Distance, lower is better | Distance, lower is better | Squared distance, lower is better |

Do not carry a score threshold across providers without checking it against real data.

## Filter edge cases

The compilers agree on scalar fields with present values. Two cases differ:

- Negation and missing fields. `ne`, `notIn`, and `not` match records that lack the field on Qdrant and pgvector. Pinecone evaluates operators against present fields only, so a record without `genre` does not match `ne("genre", "drama")` there.
- Array-valued fields. `eq("tags", "x")` and `isIn("tags", ["x"])` mean "contains x" on Qdrant and pgvector. Pinecone supports `$in` on list fields and rejects `$eq`.

If your application depends on either case, add an `exists` clause or store a scalar field to make the intent explicit.

## Features one provider lacks

- Pinecone serverless indexes reject `delete({ filter })`. The adapter returns `{ kind: "unsupported", feature: "deleteByFilter" }`. Delete by ids instead, or query first and delete the returned ids.
- Pinecone `createIndex` needs a deployment spec. The adapter defaults to serverless on AWS in `us-east-1`. Pass `indexSpec` to change it.
- pgvector `createIndex` runs `CREATE EXTENSION IF NOT EXISTS vector`, which needs a role that can create extensions. Create the extension yourself if your application role cannot.

## Verify the move

Run the live conformance suite against the new backend before you cut over:

```bash
VECSTORE_LIVE=1 QDRANT_URL=http://localhost:6333 bun run test:live
```

The suite creates a temporary index, exercises every verb and filter operator, and deletes the index.
