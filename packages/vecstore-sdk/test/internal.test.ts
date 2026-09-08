import { describe, expect, test } from "bun:test";

import { chunk, sortByIds } from "../src/internal/collections";
import { isMetadataEntry, metadataFromEntries } from "../src/internal/metadata";
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

describe("collections", () => {
  test("chunk splits into fixed-size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toStrictEqual([]);
  });

  test("sortByIds follows the requested order and skips misses", () => {
    const records = [{ id: "b" }, { id: "a" }];
    expect(sortByIds(["a", "x", "b"], records)).toStrictEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});
