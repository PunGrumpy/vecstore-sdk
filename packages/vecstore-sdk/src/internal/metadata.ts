import { invalidArgument } from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { Metadata, MetadataValue, VectorRecord } from "../types";
import { isBoolean, isNumber, isString, isStringArray } from "./guards";

export type MetadataEntry = [string, MetadataValue];

export const isMetadataValue = (value: unknown): value is MetadataValue =>
  isString(value) ||
  isNumber(value) ||
  isBoolean(value) ||
  isStringArray(value);

export const isMetadataEntry = (
  entry: [string, unknown]
): entry is MetadataEntry => isMetadataValue(entry[1]);

export const metadataFromEntries = (
  entries: readonly MetadataEntry[],
  omit: ReadonlySet<string> = new Set()
): Metadata => Object.fromEntries(entries.filter(([key]) => !omit.has(key)));

export const reservedKeyError = (
  provider: Provider,
  records: readonly VectorRecord[],
  reserved: ReadonlySet<string>
): VecstoreError | undefined => {
  for (const record of records) {
    for (const key of Object.keys(record.metadata ?? {})) {
      if (reserved.has(key)) {
        return invalidArgument(
          provider,
          `The ${provider} adapter keeps the metadata key "${key}" for itself. Record "${record.id}" sets it; rename the field.`
        );
      }
    }
  }
  return undefined;
};
