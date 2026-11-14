import type { VecstoreError } from "./errors";

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ error, ok: false });

export const unwrap = <T>(result: Result<T, VecstoreError>): T => {
  if (result.ok) {
    return result.value;
  }

  const { error } = result;

  throw new Error(`${error.provider} ${error.kind}: ${error.message}`, {
    cause: error,
  });
};
