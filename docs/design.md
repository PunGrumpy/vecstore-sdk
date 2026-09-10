# Design

This page explains the design decisions behind vecstore-sdk. It follows the rationale template from the architect skill.

## Problem

Three vector databases share four verbs and disagree on the metadata filter language, id rules, namespace support, and error types. An application that starts on one provider cannot move without rewriting every query. The design has to express filters once and compile them exactly on every provider. It has to do that without pulling any provider SDK into the core bundle.

Three constraints applied:

- The provider SDKs stay optional peer dependencies. The adapters import only their types.
- Types are the contract. There is no runtime schema library and no validation of caller input.
- The repository lint preset bans `unknown` and `object` parameters, `any`-valued dictionaries, casts, and `typeof` outside type predicates. Named type predicates therefore narrow provider payloads at the boundary.

## Usage

The caller constructs the native client, wraps it, and never touches provider syntax again:

```ts
const store = createQdrantStore({ client: new QdrantClient({ url }) });
const docs = store.index("docs", { namespace: "tenant_1" });

await docs.upsert(records);
const result = await docs.query({
  vector,
  topK: 10,
  filter: and(eq("genre", "drama"), not(isIn("year", [1999, 2000]))),
});

if (!result.ok && result.error.kind === "unsupported") {
  fallback(result.error.feature);
}
```

`store.raw` returns the client with its original type, so the SDK never blocks a provider-specific call.

## Shape

**Filter AST.** A discriminated union on `kind` with leaf nodes (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `exists`) and combinators (`and`, `or`, `not`). Membership and combinator children are non-empty tuples, so an empty `in` or `and` cannot be built. Builders are plain functions, one per node.

**Compilers.** One pure function per provider from `Filter` to the provider's native filter type. All four are total on the operators: no filter fails to compile for want of one. Where a provider lacks an operator, the compiler rewrites instead of degrading. Qdrant has no float `match`, so `eq` on a float becomes a closed `range`. Pinecone has no `$not`, so the compiler pushes negation to the leaves with De Morgan's laws. Its `$in` rejects booleans, so those expand to `$or` of `$eq`. Upstash has no `NOT` either and takes the same pushdown. Upstash is the one compiler that can reject its input, because its filter is a string. A field name or a string value the Upstash grammar cannot hold safely throws rather than being written into a query.

**Adapters.** Each adapter takes a client that satisfies a structural `*ClientLike` interface listing only the methods it calls. The real SDK client satisfies it, and tests use fakes. The store is generic over the client type, so `raw` keeps the caller's concrete type. Every verb runs inside one `run` helper that converts a thrown SDK error to a `VecstoreError` and returns a `Result`.

**Boundary parsing.** Provider responses arrive typed as `object | null` and pass through type predicates (`isRecordRow`, `isMetadataEntry`, `isHttpFailure`) before anything is read. The adapter rebuilds metadata from the entries that pass `isMetadataEntry`. That drops values outside the portable type and the adapter's reserved keys.

**Emulation.** Qdrant gets namespaces through a `_namespace` payload key with a tenant index. It gets arbitrary ids through a deterministic UUID, with the original id kept in `_id`. pgvector gets namespaces through a column in the primary key. Upstash gives one namespace level and the index name uses it, so by default the adapter emulates the namespace with a `_namespace` metadata key and prefixes stored ids with it, keeping the original in `_id`. `namespaceMode: "native"` spends a real Upstash namespace per index and namespace pair instead, named `{index}~{namespace}`, and stores ids and metadata untouched. The adapter sections of the README document all three. All of them round-trip exactly.

**Interface depth.** The public API is four record verbs, three index verbs, eleven filter builders, and one error union. It hides id hashing, namespace scoping, batching, metric detection from the Postgres catalog, and the mapping of three error taxonomies to one.

## Synthesis decision

The constraints left room for one shape, a compile-time AST with total compilers and structural client interfaces. The alternatives below lost during the sketch.

## Tradeoffs accepted

- We accept a flat metadata type in exchange for records that upsert on every provider.
- We accept extra payload keys on Qdrant and Upstash and an extra column on pgvector in exchange for namespaces everywhere.
- We accept that Upstash's default mode makes every query a filtered query, and so subject to Upstash's filtering budget, in exchange for a tenant count no provider limit bounds. `namespaceMode: "native"` inverts the trade for callers who can name their namespaces up front.
- We accept provider-native scores in exchange for not guessing a normalization that Pinecone's squared euclidean distance would break. Upstash normalizes on its own and we pass that through unchanged.
- We accept that negation on missing fields differs by provider, and we document the difference. In exchange, the compilers use native operators and keep indexes usable.
- We accept that pgvector runs one catalog query per index handle to learn the metric, in exchange for working against tables the caller created.

## Alternatives considered

- **A MongoDB-style object filter as the public type.** Familiar, but it bends the AST toward Pinecone, cannot enforce non-empty lists, and makes `not` awkward.
- **Compilers that return `Result` with an `unsupported` branch.** Rejected because every operator is expressible on every provider once the rewrites above exist. The branch would be unreachable.
- **Only mapping Upstash namespaces natively, with no metadata mode.** Rejected as the default because Upstash caps namespaces at 100 on the free plan and 10,000 on the paid plans, which would cap tenants. It survives as `namespaceMode: "native"`.
- **Driving Upstash from its developer API so `createIndex` creates a real vector index.** Rejected because it needs an account email and a management key that `@upstash/vector` never asks for, and because it would create a billed serverless database per `createIndex` call.
- **Adapters that construct the client from a config object.** Rejected because a runtime import of the SDK turns an optional peer into a real dependency. It also hides client options the SDK already exposes.
- **A registry table for pgvector metrics.** Rejected in favor of reading the index opclass from `pg_indexes`. That also works for tables the SDK did not create.

## Open questions and risks

- Should `fetch` and `query` expose the reserved Qdrant keys through an option, for callers who read the collection with other tools?
- Pinecone lists `deleteByFilter` as unsupported only on serverless indexes. The adapter detects this from the error message of a failed call. Is a pre-flight `describeIndex` worth the extra request?
- Should the pgvector adapter accept an existing table without a `namespace` column when the caller never uses namespaces?
- Upstash namespaces only appear in `listNamespaces` after the first write, so `createIndex` cannot report `already_exists` for an empty one. Is a marker record worth the write?

## Next implementation step

Run the live conformance suite against a Qdrant container and a pgvector container, then publish `0.1.0`.
