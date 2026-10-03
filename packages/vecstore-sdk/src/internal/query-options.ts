import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { QueryOptions } from "../types";
import { filterError } from "./filter";

export const queryOptionsError = (
  provider: Provider,
  query: QueryOptions
): VecstoreError | undefined => {
  if (!(Number.isSafeInteger(query.topK) && query.topK > 0)) {
    return invalidArgument(
      provider,
      `topK must be a positive integer, got ${String(query.topK)}`
    );
  }
  return query.filter === undefined
    ? undefined
    : filterError(provider, query.filter);
};
