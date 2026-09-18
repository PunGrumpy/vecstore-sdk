import { describe, expect, test } from "bun:test";

import { chunk, lastById, sortByIds } from "../src/internal/collections";
import { indexSpecError } from "../src/internal/index-spec";
import {
  isMetadataEntry,
  metadataFromEntries,
  reservedKeyError,
} from "../src/internal/metadata";
import { namespaceError } from "../src/internal/namespace";
import { deterministicUuid, isUuid } from "../src/internal/uuid";

describe(deterministicUuid, () => {
  test("is stable for the same input and distinct across namespaces", () => {
    const first = deterministicUuid("ns", "doc-1");
    expect(deterministicUuid("ns", "doc-1")).toBe(first);
    expect(deterministicUuid("other", "doc-1")).not.toBe(first);
    expect(deterministicUuid("ns", "doc-2")).not.toBe(first);
  });

  test("produces a lowercase version 8 UUID", () => {
    const id = deterministicUuid("ns", "doc-1");
    expect(isUuid(id)).toBeTruthy();
    expect(id.charAt(14)).toBe("8");
  });
});

describe(isUuid, () => {
  test("accepts lowercase RFC 4122 UUIDs only", () => {
    expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBeTruthy();
    expect(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBeFalsy();
    expect(isUuid("doc-1")).toBeFalsy();
  });
});

describe("metadata entries", () => {
  test("keeps portable values and drops the rest", () => {
    const entries = Object.entries({
      _id: "z",
      a: "x",
      b: 1,
      c: true,
      d: ["y"],
      e: { nested: 1 },
      f: null,
    }).filter(isMetadataEntry);
    expect(metadataFromEntries(entries, new Set(["_id"]))).toStrictEqual({
      a: "x",
      b: 1,
      c: true,
      d: ["y"],
    });
  });
});

describe(reservedKeyError, () => {
  test("names the first record that sets a reserved key", () => {
    const reserved = new Set(["_id"]);
    expect(
      reservedKeyError("qdrant", [{ id: "a", vector: [1] }], reserved)
    ).toBeUndefined();
    const error = reservedKeyError(
      "qdrant",
      [{ id: "a", metadata: { _id: "other" }, vector: [1] }],
      reserved
    );
    expect(error?.kind).toBe("invalid_argument");
    expect(error?.message).toContain('Record "a"');
  });
});

describe(namespaceError, () => {
  test("only a namespace holding the encoding separator is an error", () => {
    expect(namespaceError("qdrant", "tenant-a")).toBeUndefined();
    expect(namespaceError("qdrant", "a/3")?.kind).toBe("invalid_argument");
  });
});

describe(indexSpecError, () => {
  test("only a positive integer dimension is accepted", () => {
    expect(
      indexSpecError("qdrant", { dimension: 3, name: "docs" })
    ).toBeUndefined();
    expect(
      indexSpecError("qdrant", { dimension: 1.5, name: "docs" })?.kind
    ).toBe("invalid_argument");
    expect(indexSpecError("qdrant", { dimension: 0, name: "docs" })?.kind).toBe(
      "invalid_argument"
    );
    expect(
      indexSpecError("qdrant", { dimension: -3, name: "docs" })?.kind
    ).toBe("invalid_argument");
  });
});

describe("collections", () => {
  test("chunk splits into fixed-size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toStrictEqual([]);
  });

  test("lastById keeps the first position and the last data", () => {
    expect(
      lastById([
        { id: "a", n: 1 },
        { id: "b", n: 2 },
        { id: "a", n: 3 },
      ])
    ).toStrictEqual([
      { id: "a", n: 3 },
      { id: "b", n: 2 },
    ]);
  });

  test("sortByIds follows the requested order and skips misses", () => {
    const records = [{ id: "b" }, { id: "a" }];
    expect(sortByIds(["a", "x", "b"], records)).toStrictEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});
