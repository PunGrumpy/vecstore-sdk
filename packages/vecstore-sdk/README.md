# vecstore-sdk

A unified vector store SDK for TypeScript. One filter language across Qdrant, pgvector, and Pinecone, so you can switch providers without rewriting queries.

## Description

Vector databases share the same create, read, update, delete verbs but disagree on metadata filter syntax: Pinecone uses MongoDB-style operators, Qdrant uses `must`/`should` clauses, pgvector uses SQL. Switching providers means rewriting every query you have.

vecstore-sdk defines one filter abstract syntax tree (AST) that compiles to each provider's native syntax, behind a small adapter API. Embedding generation stays out of scope, so pair it with `embed()` from `ai-sdk`.

## Plan

Four phases, ordered so the hardest design decision lands first.

### Phase 1: filter AST

Design the filter type and its compilers before anything else. Write the Qdrant, pgvector, and Pinecone compilers in parallel: building one first bends the AST toward that provider. Types are compile-time only, with no runtime schema validation.

### Phase 2: core API

Build the adapter interface, the verb surface, normalized errors, and the `.raw` escape hatch. Each adapter is a subpath export, and each provider's native SDK is an optional peer dependency.

### Phase 3: release

Write docs, run live tests against real backends, publish v0.1.

### Phase 4: deferred

Hold `vecstore-sdk/effect`, hybrid search, reranking, and further adapters until real usage tells you which one people ask for.

## Scope

v0 covers filtering and the core verbs. Everything that varies by provider or belongs to another library waits.

Included:

- **Filter AST**: one type plus per-provider compilers
- **Vector verbs**: `upsert`, `query`, `fetch`, `delete`
- **Index lifecycle**: `createIndex`, `deleteIndex`, `listIndexes`
- **Scoping**: namespaces and collections
- **Errors**: discriminated unions, not thrown `Error` objects
- **Capability detection**: throw on an unsupported feature instead of degrading silently
- **Adapters**: Qdrant, pgvector, Pinecone

Excluded from v0:

- Embedding generation
- Hybrid and sparse vector search
- Reranking
- Effect integration
- Chunking, loaders, retrieval-augmented generation helpers

## Outcome

Four things change for someone using the library.

- Switching providers costs one import and one config object
- The compiler catches filter mistakes before you run anything
- Unsupported features fail with a named error you can match on
- Your bundle includes only the adapter you imported

## Deliverable

Five artifacts ship with v0.1.

- `vecstore-sdk` on npm: core, types, filter AST
- `vecstore-sdk/qdrant`, `vecstore-sdk/pgvector`, `vecstore-sdk/pinecone`
- Docs site covering per-adapter setup and filter compilation
- Provider migration guide
- Live test suite, opt-in behind an environment flag
