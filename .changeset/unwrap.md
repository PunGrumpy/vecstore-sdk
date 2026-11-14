---
"vecstore-sdk": minor
---

Add `unwrap`, which returns the value of a successful `Result` and throws an `Error` for a failed one. The error's message names the provider and the kind, such as `qdrant connection: fetch failed`, and its `cause` is the original `VecstoreError`. Code that only wants to stop on a failure no longer writes `throw new Error(result.error.message)`, which dropped both.
