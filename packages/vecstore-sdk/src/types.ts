import type { Provider, VecstoreError } from "./errors";
import type { Filter, NonEmpty } from "./filter/ast";
import type { Result } from "./result";

export type Metric = "cosine" | "euclidean" | "dot";

export type MetadataValue = string | number | boolean | string[];

export type Metadata = Readonly<Record<string, MetadataValue>>;

export interface VectorRecord {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata?: Metadata;
}

export interface ScoredRecord {
  readonly id: string;
  readonly score: number;
  readonly vector?: readonly number[];
  readonly metadata?: Metadata;
}

export interface IndexSpec {
  readonly name: string;
  readonly dimension: number;
  readonly metric?: Metric;
}

export interface IndexOptions {
  readonly namespace?: string;
}

export interface QueryOptions {
  readonly vector: readonly number[];
  readonly topK: number;
  readonly filter?: Filter;
  readonly includeMetadata?: boolean;
  readonly includeVector?: boolean;
}

export interface FetchOptions {
  readonly includeVector?: boolean;
}

export type DeleteSelector =
  | { readonly ids: NonEmpty<string> }
  | { readonly filter: Filter }
  | { readonly all: true };

export type VecResult<T> = Promise<Result<T, VecstoreError>>;

export interface VectorIndex {
  readonly name: string;
  readonly namespace: string | undefined;
  readonly upsert: (records: readonly VectorRecord[]) => VecResult<void>;
  readonly query: (options: QueryOptions) => VecResult<ScoredRecord[]>;
  readonly fetch: (
    ids: readonly string[],
    options?: FetchOptions
  ) => VecResult<VectorRecord[]>;
  readonly delete: (selector: DeleteSelector) => VecResult<void>;
}

export interface VectorStore<Raw> {
  readonly provider: Provider;
  readonly raw: Raw;
  readonly index: (name: string, options?: IndexOptions) => VectorIndex;
  readonly createIndex: (spec: IndexSpec) => VecResult<void>;
  readonly deleteIndex: (name: string) => VecResult<void>;
  readonly listIndexes: () => VecResult<string[]>;
}
