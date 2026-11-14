import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { QueryOptions } from "../types";
import { filterError } from "./filter";
import { queryVectorError } from "./vector";

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

  const invalidVector = queryVectorError(provider, query.vector);

  if (invalidVector !== undefined) {
    return invalidVector;
  }

  return query.filter === undefined
    ? undefined
    : filterError(provider, query.filter);
};
