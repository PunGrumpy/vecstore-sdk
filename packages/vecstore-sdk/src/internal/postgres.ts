import {
  alreadyExists,
  connection,
  invalidArgument,
  notFound,
  providerError,
  unauthorized,
} from "../errors";
import type { Provider, VecstoreError } from "../errors";
import type { Metadata, ScoredRecord, VectorRecord } from "../types";
import { isNumberArray, isObjectLike, isString } from "./guards";
import { isMetadataEntry, metadataFromEntries } from "./metadata";

const UNDEFINED_TABLE = "42P01";
const DUPLICATE_TABLE = "42P07";
const INSUFFICIENT_PRIVILEGE = "42501";
const ADMIN_SHUTDOWN = "57P01";
const CONNECTION_CLASS = "08";
const AUTH_CLASS = "28";
const DATA_CLASS = "22";
const INTEGRITY_CLASS = "23";
const SYNTAX_CLASS = "42";

const NODE_CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
]);

export const hasCode = (cause: unknown): cause is Error & { code: string } =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string";

const isConnectionCode = (code: string): boolean =>
  NODE_CONNECTION_CODES.has(code) ||
  code === ADMIN_SHUTDOWN ||
  code.startsWith(CONNECTION_CLASS);

const isAuthCode = (code: string): boolean =>
  code === INSUFFICIENT_PRIVILEGE || code.startsWith(AUTH_CLASS);

const isArgumentCode = (code: string): boolean =>
  code.startsWith(DATA_CLASS) ||
  code.startsWith(INTEGRITY_CLASS) ||
  code.startsWith(SYNTAX_CLASS);

export const normalizePostgresError = (
  provider: Provider,
  cause: unknown,
  index: string
): VecstoreError => {
  if (!hasCode(cause)) {
    return providerError(provider, cause);
  }
  const { code } = cause;
  if (code === UNDEFINED_TABLE) {
    return notFound(provider, index, cause);
  }
  if (code === DUPLICATE_TABLE) {
    return alreadyExists(provider, index, cause);
  }
  if (isConnectionCode(code)) {
    return connection(provider, cause);
  }
  if (isAuthCode(code)) {
    return unauthorized(provider, cause);
  }
  if (isArgumentCode(code)) {
    return invalidArgument(provider, cause.message, cause);
  }
  return providerError(provider, cause);
};

export interface PostgresRow {
  readonly id: string;
  readonly metadata?: object | null;
  readonly embedding?: string | null;
  readonly score?: number;
}

export const isPostgresRow = (row: unknown): row is PostgresRow =>
  isObjectLike(row) && "id" in row && typeof row.id === "string";

export interface NamedRow {
  readonly name: string;
}

export const isNamedRow = (row: unknown): row is NamedRow =>
  isObjectLike(row) && "name" in row && typeof row.name === "string";

export const vectorLiteral = (vector: readonly number[]): string =>
  `[${vector.join(",")}]`;

const rowMetadata = (row: PostgresRow): Metadata =>
  metadataFromEntries(
    Object.entries(row.metadata ?? {}).filter(isMetadataEntry)
  );

const rowVector = (row: PostgresRow): number[] => {
  if (!isString(row.embedding)) {
    return [];
  }
  const parsed = JSON.parse(row.embedding);
  return isNumberArray(parsed) ? parsed : [];
};

export const toVectorRecord = (row: PostgresRow): VectorRecord => ({
  id: row.id,
  metadata: rowMetadata(row),
  vector: rowVector(row),
});

export const toScoredRecord = (
  row: PostgresRow,
  includeMetadata: boolean,
  includeVector: boolean
): ScoredRecord => ({
  id: row.id,
  metadata: includeMetadata ? rowMetadata(row) : undefined,
  score: row.score ?? 0,
  vector: includeVector ? rowVector(row) : undefined,
});
