import type { Metadata, MetadataValue } from "../types";
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
