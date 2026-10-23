import { isObjectLike } from "./guards";

const NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENETUNREACH",
]);

const FETCH_FAILED = "fetch failed";

export const isNetworkCode = (code: string): boolean => NETWORK_CODES.has(code);

const carriesNetworkCode = (value: unknown): value is { code: string } =>
  isObjectLike(value) &&
  "code" in value &&
  typeof value.code === "string" &&
  isNetworkCode(value.code);

const isFetchFailed = (error: Error): boolean =>
  error.name === "TypeError" && error.message === FETCH_FAILED;

export const isNetworkFailure = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) {
    return false;
  }

  return (
    carriesNetworkCode(cause) ||
    carriesNetworkCode(cause.cause) ||
    isFetchFailed(cause)
  );
};
