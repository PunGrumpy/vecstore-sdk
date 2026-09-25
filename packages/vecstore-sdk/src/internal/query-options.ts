import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { QueryOptions } from "../types";

export const queryOptionsError = (
  provider: Provider,
  query: QueryOptions
): VecstoreError | undefined =>
  Number.isSafeInteger(query.topK) && query.topK > 0
    ? undefined
    : invalidArgument(
        provider,
        `topK must be a positive integer, got ${String(query.topK)}`
      );
