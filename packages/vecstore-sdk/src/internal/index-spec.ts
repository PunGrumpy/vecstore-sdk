import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { IndexSpec } from "../types";

export const indexSpecError = (
  provider: Provider,
  spec: IndexSpec
): VecstoreError | undefined =>
  Number.isInteger(spec.dimension) && spec.dimension > 0
    ? undefined
    : invalidArgument(
        provider,
        `dimension must be a positive integer, got ${spec.dimension}`
      );
