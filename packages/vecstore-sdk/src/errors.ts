import { isString } from "./internal/guards";

export type Provider =
  | "qdrant"
  | "pgvector"
  | "pinecone"
  | "redis"
  | "supabase"
  | "upstash"
  | "vectorize";

interface ErrorBase {
  readonly provider: Provider;
  readonly message: string;
  readonly cause?: unknown;
}

export interface UnsupportedError extends ErrorBase {
  readonly kind: "unsupported";
  readonly feature: string;
}

export interface NotFoundError extends ErrorBase {
  readonly kind: "not_found";
  readonly resource: "index";
  readonly name: string;
}

export interface AlreadyExistsError extends ErrorBase {
  readonly kind: "already_exists";
  readonly resource: "index";
  readonly name: string;
}

export interface InvalidArgumentError extends ErrorBase {
  readonly kind: "invalid_argument";
}

export interface UnauthorizedError extends ErrorBase {
  readonly kind: "unauthorized";
}

export interface ConnectionError extends ErrorBase {
  readonly kind: "connection";
}

export interface ProviderError extends ErrorBase {
  readonly kind: "provider";
}

export type VecstoreError =
  | UnsupportedError
  | NotFoundError
  | AlreadyExistsError
  | InvalidArgumentError
  | UnauthorizedError
  | ConnectionError
  | ProviderError;

export const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (isString(cause)) {
    return cause;
  }
  return "Unknown error";
};

export const unsupported = (
  provider: Provider,
  feature: string,
  message: string
): UnsupportedError => ({ feature, kind: "unsupported", message, provider });

export const notFound = (
  provider: Provider,
  name: string,
  cause?: unknown
): NotFoundError => ({
  cause,
  kind: "not_found",
  message: `Index "${name}" was not found`,
  name,
  provider,
  resource: "index",
});

export const alreadyExists = (
  provider: Provider,
  name: string,
  cause?: unknown
): AlreadyExistsError => ({
  cause,
  kind: "already_exists",
  message: `Index "${name}" already exists`,
  name,
  provider,
  resource: "index",
});

export const invalidArgument = (
  provider: Provider,
  message: string,
  cause?: unknown
): InvalidArgumentError => ({
  cause,
  kind: "invalid_argument",
  message,
  provider,
});

export const unauthorized = (
  provider: Provider,
  cause: unknown
): UnauthorizedError => ({
  cause,
  kind: "unauthorized",
  message: errorMessage(cause),
  provider,
});

export const connection = (
  provider: Provider,
  cause: unknown
): ConnectionError => ({
  cause,
  kind: "connection",
  message: errorMessage(cause),
  provider,
});

export const providerError = (
  provider: Provider,
  cause: unknown
): ProviderError => ({
  cause,
  kind: "provider",
  message: errorMessage(cause),
  provider,
});
