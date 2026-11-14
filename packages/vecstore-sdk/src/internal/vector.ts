import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { VectorRecord } from "../types";

type VectorValues = readonly number[] | Float32Array | Float64Array;

const isVectorValues = (
  value: VectorValues | undefined
): value is VectorValues =>
  Array.isArray(value) ||
  value instanceof Float32Array ||
  value instanceof Float64Array;

const isFiniteVector = (vector: VectorValues): boolean =>
  vector.every((value) => Number.isFinite(value));

const recordVectorMessage = (
  record: VectorRecord,
  dimension: number
): string | undefined => {
  if (!isVectorValues(record.vector)) {
    return `Record "${record.id}" has no vector. Pass an array of numbers.`;
  }

  if (record.vector.length === 0) {
    return `Record "${record.id}" has no vector values. fetch returns vectors only when you pass { includeVector: true }.`;
  }

  if (!isFiniteVector(record.vector)) {
    return `Record "${record.id}" has a vector value that is not a finite number.`;
  }

  if (record.vector.length !== dimension) {
    return `Record "${record.id}" has ${record.vector.length} dimensions, but the first record in this upsert has ${dimension}.`;
  }

  return undefined;
};

export const recordsError = (
  provider: Provider,
  records: readonly VectorRecord[]
): VecstoreError | undefined => {
  const first = records[0]?.vector;
  const dimension = isVectorValues(first) ? first.length : 0;

  for (const record of records) {
    const message = recordVectorMessage(record, dimension);

    if (message !== undefined) {
      return invalidArgument(provider, message);
    }
  }

  return undefined;
};

export const queryVectorError = (
  provider: Provider,
  vector: readonly number[]
): VecstoreError | undefined =>
  isVectorValues(vector) && vector.length > 0 && isFiniteVector(vector)
    ? undefined
    : invalidArgument(
        provider,
        "The query vector must hold at least one finite number."
      );
