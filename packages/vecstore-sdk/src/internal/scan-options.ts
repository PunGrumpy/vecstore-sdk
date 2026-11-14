import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { ScanOptions } from "../types";
import { isString } from "./guards";

export const DEFAULT_SCAN_LIMIT = 100;
export const MAX_SCAN_LIMIT = 1000;

export const scanOptionsError = (
  provider: Provider,
  options: ScanOptions | undefined
): VecstoreError | undefined => {
  const limit = options?.limit;

  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0)) {
    return invalidArgument(
      provider,
      `limit must be a positive integer, got ${String(limit)}`
    );
  }

  const cursor = options?.cursor;

  if (cursor !== undefined && !(isString(cursor) && cursor !== "")) {
    return invalidArgument(
      provider,
      `cursor must be the non-empty string a previous scan returned, got ${JSON.stringify(cursor)}`
    );
  }

  return undefined;
};

export const scanLimit = (
  options: ScanOptions | undefined,
  max: number = MAX_SCAN_LIMIT
): number => Math.min(options?.limit ?? DEFAULT_SCAN_LIMIT, max);
