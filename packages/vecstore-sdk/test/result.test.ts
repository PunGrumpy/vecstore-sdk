import { describe, expect, test } from "bun:test";

import { connection } from "../src/errors";
import { err, ok, unwrap } from "../src/result";

describe(unwrap, () => {
  test("returns the value of a successful result", () => {
    expect(unwrap(ok(["doc-1"]))).toStrictEqual(["doc-1"]);
  });

  test("throws an Error that names the provider and kind and keeps the error as cause", () => {
    const failure = connection("qdrant", new Error("fetch failed"));

    expect(() => unwrap(err(failure))).toThrow(
      new Error("qdrant connection: fetch failed", { cause: failure })
    );
    expect(() => unwrap(err(failure))).toThrow(
      expect.objectContaining({ cause: failure })
    );
  });
});
