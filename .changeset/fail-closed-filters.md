---
"vecstore-sdk": patch
---

Reject a malformed filter or delete selector before it reaches the provider. A filter value goes through `JSON.stringify`, so `NaN` and `Infinity` became `null` and a value that was `undefined` at runtime disappeared. The provider read the result as a wider filter: on pgvector `delete({ filter: gte("year", NaN) })` removed every record with a numeric `year`, and `eq("tenant", undefined)` matched the whole namespace. Every adapter's `query` and `delete` now return `invalid_argument` for a filter whose value is not a string, a finite number, or a boolean, whose range bound is not a finite number, or whose list or combinator is empty. `delete` also returns `invalid_argument` for a selector that is not `{ ids }` with at least one id, `{ filter }`, or `{ all: true }`. Before, any other object, such as `{}` or `{ all: false }` from untyped code, deleted the whole namespace on six adapters. Calls that satisfy the types and carry finite numbers behave as before.
