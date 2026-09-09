import type { VecstoreError } from "../errors";
import { err, ok } from "../result";
import type { VecResult } from "../types";

export const attempt = async <T>(
  normalize: (cause: unknown) => VecstoreError,
  action: () => Promise<T>
): VecResult<T> => {
  try {
    return ok(await action());
  } catch (error) {
    return err(normalize(error));
  }
};
