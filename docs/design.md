# Design

This page explains the design decisions behind vecstore-sdk. It follows the rationale template from the architect skill.

## Problem

Six vector databases share four verbs and disagree on the metadata filter language, id rules, namespace support, and error types. An application that starts on one provider cannot move without rewriting every query. The design has to express filters once and compile them exactly on every provider. It has to do that without pulling any provider SDK into the core bundle.

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

**Compilers.** One pure function per provider from `Filter` to the provider's native filter type. Five of the six are total on the operators: no filter fails to compile for want of one. Where a provider lacks an operator, the compiler rewrites instead of degrading. Qdrant has no float `match`, so `eq` on a float becomes a closed `range`. Pinecone has no `$not`, so the compiler pushes negation to the leaves with De Morgan's laws. Its `$in` rejects booleans, so those expand to `$or` of `$eq`. Upstash has no `NOT` either and takes the same pushdown. Upstash can reject its input, because its filter is a string. A field name or a string value the Upstash grammar cannot hold safely throws rather than being written into a query. Vectorize is the one provider whose filter language is genuinely smaller than the AST. A Vectorize filter is a flat object of fields joined with AND, so `or` has no rewrite and `exists` has no operator. `compileVectorizeFilter` returns a `Result` rather than throwing, and the adapter turns the failure into an `unsupported` error before it sends a request. Supabase has no TypeScript compiler at all. The filter is already JSON, so it crosses as data and `vecstore_filter_sql` emits the pgvector predicates inside Postgres.

**Adapters.** Most adapters take a client that satisfies a structural `*ClientLike` interface listing only the methods it calls. The real SDK client satisfies it, and tests use fakes. The Vectorize adapter names the `cloudflare` type instead, because two of the responses it needs are typed `unknown` there and a structural interface would have to restate that `unknown` in the SDK's own signatures. Naming the type keeps the `unknown` inside the adapter, where a type predicate parses it, and its tests drive a real `Cloudflare` client with a fake `fetch`. The store is generic over the client type either way, so `raw` keeps the caller's concrete type. Every verb runs inside one `run` helper that converts a thrown SDK error to a `VecstoreError` and returns a `Result`.

**Boundary parsing.** Provider responses arrive typed as `object | null` and pass through type predicates (`isPostgresRow`, `isMetadataEntry`, `isHttpFailure`) before anything is read. The adapter rebuilds metadata from the entries that pass `isMetadataEntry`. That drops values outside the portable type and the adapter's reserved keys.

**Emulation.** Qdrant gets namespaces through a `_namespace` payload key with a tenant index. It gets arbitrary ids through a deterministic UUID, with the original id kept in `_id`. Vectorize has native namespaces but scopes ids to the index rather than to the namespace, and caps an id at 64 bytes, so it borrows the Qdrant id hashing: a namespaced record, or one whose id is too long, is stored under a deterministic UUID with the original in `_id`. pgvector and Supabase get namespaces through a column in the primary key. Upstash gives one namespace level and the index name uses it, so by default the adapter emulates the namespace with a `_namespace` metadata key and prefixes stored ids with it, keeping the original in `_id`. `namespaceMode: "native"` spends a real Upstash namespace per index and namespace pair instead, named `{index}~{namespace}`, and stores ids and metadata untouched. The adapter sections of the README document all of them. All of them round-trip exactly.

**Interface depth.** The public API is four record verbs, three index verbs, eleven filter builders, and one error union. It hides id hashing, namespace scoping, batching, NDJSON upload framing, metric detection from the Postgres catalog, and the mapping of several error taxonomies to one.

## Synthesis decision

The constraints left room for one shape, a compile-time AST with compilers that rewrite rather than degrade, and client types that name only what the adapter calls. The alternatives below lost during the sketch.

## Tradeoffs accepted

- We accept a flat metadata type in exchange for records that upsert on every provider.
- We accept extra payload keys on Qdrant and Upstash and an extra column on pgvector and Supabase in exchange for namespaces everywhere.
- We accept that Upstash's default mode makes every query a filtered query, and so subject to Upstash's filtering budget, in exchange for a tenant count no provider limit bounds. `namespaceMode: "native"` inverts the trade for callers who can name their namespaces up front.
- We accept provider-native scores in exchange for not guessing a normalization that Pinecone's squared euclidean distance would break. Upstash normalizes on its own and we pass that through unchanged.
- We accept that negation on missing fields differs by provider, and we document the difference. In exchange, the compilers use native operators and keep indexes usable.
- We accept that pgvector runs one catalog query per index handle to learn the metric, in exchange for working against tables the caller created.
- We accept that three Vectorize verbs return `unsupported`, in exchange for an adapter that says what the product does instead of pretending. Vectorize deletes by id only, so `delete({ filter })` and `delete({ all: true })` have nothing to compile to, and its filter language has no OR.
- We accept that a Vectorize query always asks for metadata, which caps `topK` at 50 instead of 100, in exchange for the original id coming back on every match.
- We accept that the Vectorize adapter sends a `namespace` field the generated `cloudflare` types do not declare. `wrangler vectorize query --namespace` posts the same field to the same endpoint, so the API accepts it and only the OpenAPI description is behind.
- We accept a one-time SQL install on Supabase, in exchange for the whole store contract working over HTTP. PostgREST has no syntax for `order by embedding <=> $1`, so without the install the adapter could only offer a partial store.

## Alternatives considered

- **A MongoDB-style object filter as the public type.** Familiar, but it bends the AST toward Pinecone, cannot enforce non-empty lists, and makes `not` awkward.
- **Compilers that return `Result` with an `unsupported` branch.** Rejected for the first five providers, because every operator is expressible there once the rewrites above exist and the branch would be unreachable. Vectorize brought a filter language with no OR and no presence test, so `compileVectorizeFilter` returns a `Result` and the other five still do not.
- **Only mapping Upstash namespaces natively, with no metadata mode.** Rejected as the default because Upstash caps namespaces at 100 on the free plan and 10,000 on the paid plans, which would cap tenants. It survives as `namespaceMode: "native"`.
- **Driving Upstash from its developer API so `createIndex` creates a real vector index.** Rejected because it needs an account email and a management key that `@upstash/vector` never asks for, and because it would create a billed serverless database per `createIndex` call.
- **A Vectorize adapter over the Workers binding.** The binding is the idiomatic way to reach Vectorize and needs no API token, but it holds one index and has no call that creates, deletes, or lists indexes, and no way to enumerate namespaces or vectors. Three of the seven store verbs would be permanently `unsupported` and `index(name)` would not mean anything. The HTTP API is the only shape where the whole store contract works.
- **A Vectorize adapter that emulates namespaces in metadata.** Rejected because Vectorize has real namespaces, and because a metadata namespace would spend one of the ten metadata indexes an index is allowed and put a clause on every query.
- **Adapters that construct the client from a config object.** Rejected because a runtime import of the SDK turns an optional peer into a real dependency. It also hides client options the SDK already exposes.
- **A registry table for pgvector metrics.** Rejected in favor of reading the index opclass from `pg_indexes`. That also works for tables the SDK did not create.
- **Sending compiled SQL text to a Supabase function.** The pgvector compiler already parameterizes every value, so the text carries no caller data. Rejected anyway, because the function is a public PostgREST endpoint that any key can call with SQL the SDK never wrote. The filter crosses as JSON instead.
- **A Supabase adapter that wraps a Postgres connection.** Rejected because `createPgvectorStore` already accepts a Supabase connection string, and a `pg` socket rules out Edge Functions and the browser.

## Open questions and risks

- Should `fetch` and `query` expose the reserved Qdrant keys through an option, for callers who read the collection with other tools?
- Pinecone lists `deleteByFilter` as unsupported only on serverless indexes. The adapter detects this from the error message of a failed call. Is a pre-flight `describeIndex` worth the extra request?
- Should the pgvector adapter accept an existing table without a `namespace` column when the caller never uses namespaces?
- Upstash namespaces only appear in `listNamespaces` after the first write, so `createIndex` cannot report `already_exists` for an empty one. Is a marker record worth the write?
- A Vectorize filter on a property with no metadata index matches nothing rather than failing. `metadataIndexes` covers indexes the store creates. Should the adapter read `metadata_index/list` once per index handle and return `invalid_argument` for a filter on an unindexed property?
- `delete({ all: true })` could be emulated on Vectorize by querying for ids and deleting them until the namespace is empty. That is unbounded work with asynchronous mutations. Is a bounded version worth offering?
- The Supabase SQL functions live in `public` because that is the schema PostgREST exposes by default. Should the install file offer a `vecstore` schema for projects that add it to the exposed list?

## Next implementation step

Run the live conformance suite against a Qdrant container, a pgvector container, and a Vectorize index, then publish.
