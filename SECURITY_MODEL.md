# Security model

This file describes who and what vecstore-sdk trusts, so security reviews and scans judge findings against it. To report a vulnerability, see `.github/SECURITY.md`.

## System overview

vecstore-sdk is one TypeScript API over seven vector stores (pgvector, Qdrant, Pinecone, Supabase, Upstash, Cloudflare Vectorize, Redis), published to npm from `packages/vecstore-sdk`.

## Components

| Component | Code | Distribution surface |
| --- | --- | --- |
| vecstore-sdk | `packages/vecstore-sdk/src` (adapters, `filter/*`, `internal/*`) | npm package |
| CI/release | `.github/workflows/*` | npm package |

## Assets

- Vectors and metadata stored by downstream apps, and the isolation between namespaces.
- The downstream app's database and provider credentials.
- Integrity of the published package and its release workflow.

Critical assets across the maintainer's projects, in the maintainer's words: secrets in CI of action users (Cursor API key, `GITHUB_TOKEN`); root privileges and network config on Macs running Peony; integrity of published npm packages and releases; pigo API availability; and the data of downstream apps that use the libraries (logs, vectors, LINE messages).

## Trust boundaries and entry points

- **Downstream app → SDK**: filters, ids, namespaces and index specs may come from the app's end users. The filter AST is compiled per provider (`filter/pgvector.ts` SQL, `filter/redis.ts` RediSearch, ...), so compilation is an injection boundary.
- **Constructor options** (schema, index names) are trusted developer input.

## Attackers that matter

- End users of a downstream app who control filter values, ids or namespaces.
- A supply-chain attacker targeting the release workflow or npm publish.

## Existing controls

- Identifiers are quoted with `quoteIdent`; index names are checked for the `$vecstore$` tag.

## Out of scope

- `apps/web` (docs site).
- Across the maintainer's projects: docs and marketing sites, and bench and video packages.
