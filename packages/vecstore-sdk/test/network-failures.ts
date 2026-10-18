export const NETWORK_CODES: string[] = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENETUNREACH",
];

export const SAMPLE_CODES: string[] = ["ENOTFOUND", "ECONNREFUSED"];

export const bunFetchFailure = (code: string): TypeError =>
  Object.assign(new TypeError(`${code}: Unable to connect`), { code });

export const undiciFetchFailure = (code: string): TypeError =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error(`connect ${code}`), { code }),
  });

export const codeLess = (): TypeError => new TypeError("x is not a function");

export const unrelatedCode = (): TypeError =>
  Object.assign(new TypeError("x is not a function"), { code: "ERR_X" });

export const nonNetworkCause = (): TypeError =>
  new TypeError("fetch broke", {
    cause: Object.assign(new Error("x"), { code: "ERR_X" }),
  });
