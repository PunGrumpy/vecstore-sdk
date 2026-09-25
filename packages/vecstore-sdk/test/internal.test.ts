import { describe, expect, test } from "bun:test";

import {
  chunk,
  lastById,
  mapBatches,
  sortByIds,
} from "../src/internal/collections";
import { indexSpecError } from "../src/internal/index-spec";
import {
  isMetadataEntry,
  metadataFromEntries,
  reservedKeyError,
} from "../src/internal/metadata";
import { namespaceError } from "../src/internal/namespace";
import { queryOptionsError } from "../src/internal/query-options";
import {
  deterministicUuid,
  isSurrogateUuid,
  isUuid,
} from "../src/internal/uuid";

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

  test("matches the values persisted by earlier versions", () => {
    expect(
      deterministicUuid("vecstore-sdk/qdrant/point-id", "tenant-a/5/doc-1")
    ).toBe("73f328fb-a7ca-81f7-a86a-06f5a7282959");
    expect(deterministicUuid("vecstore-sdk/qdrant/point-id", "/5/doc-1")).toBe(
      "11882748-0614-8fd6-9efe-c7506d346ab2"
    );
    expect(
      deterministicUuid("vecstore-sdk/vectorize/vector-id", "tenant-a/5/doc-1")
    ).toBe("5a2ccb9b-cbc4-8bfb-9e20-a64886ed02c1");
    expect(
      deterministicUuid(
        "vecstore-sdk/vectorize/vector-id",
        `/70/${"a".repeat(70)}`
      )
    ).toBe("7f62dd9c-602b-8ec5-aad4-fcacc6f0e1ef");
  });
});

describe(isUuid, () => {
  test("accepts lowercase RFC 4122 UUIDs only", () => {
    expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBeTruthy();
    expect(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBeFalsy();
    expect(isUuid("doc-1")).toBeFalsy();
  });
});

describe(isSurrogateUuid, () => {
  test("recognises a version 8 UUID and rejects other shapes", () => {
    expect(isSurrogateUuid(deterministicUuid("ns", "x"))).toBeTruthy();
    expect(isSurrogateUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBeFalsy();
    expect(isSurrogateUuid("doc-1")).toBeFalsy();
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

describe(queryOptionsError, () => {
  test("only a positive integer topK is accepted", () => {
    expect(
      queryOptionsError("qdrant", { topK: 1, vector: [1] })
    ).toBeUndefined();
    expect(
      queryOptionsError("qdrant", { topK: 100, vector: [1] })
    ).toBeUndefined();
    expect(queryOptionsError("qdrant", { topK: 0, vector: [1] })?.kind).toBe(
      "invalid_argument"
    );
    expect(queryOptionsError("qdrant", { topK: -1, vector: [1] })?.kind).toBe(
      "invalid_argument"
    );
    expect(queryOptionsError("qdrant", { topK: 1.5, vector: [1] })?.kind).toBe(
      "invalid_argument"
    );
    expect(
      queryOptionsError("qdrant", { topK: Number.NaN, vector: [1] })?.kind
    ).toBe("invalid_argument");
    expect(
      queryOptionsError("qdrant", {
        topK: Number.POSITIVE_INFINITY,
        vector: [1],
      })?.kind
    ).toBe("invalid_argument");
  });
});

describe(mapBatches, () => {
  test("keeps results in batch order", async () => {
    const results = await mapBatches({
      action: (batch) =>
        Promise.resolve(batch.reduce((sum, value) => sum + value, 0)),
      items: [1, 2, 3, 4, 5],
      size: 2,
    });
    expect(results).toStrictEqual([3, 7, 5]);
  });

  test("never runs more than the concurrency limit at once", async () => {
    const inFlight = { current: 0, max: 0 };
    const items = Array.from({ length: 9 }, (_, index) => index);
    await mapBatches({
      action: async (batch) => {
        inFlight.current += 1;
        inFlight.max = Math.max(inFlight.max, inFlight.current);
        await Promise.resolve();
        inFlight.current -= 1;
        return batch;
      },
      concurrency: 4,
      items,
      size: 1,
    });
    expect(inFlight.max).toBe(4);
  });

  test("resolves to an empty array without calling the action", async () => {
    const counter = { calls: 0 };
    const empty: number[] = [];
    const results = await mapBatches({
      action: (batch) => {
        counter.calls += 1;
        return Promise.resolve(batch);
      },
      items: empty,
      size: 2,
    });
    expect(results).toStrictEqual([]);
    expect(counter.calls).toBe(0);
  });

  test("propagates a rejection", async () => {
    const failure = new Error("batch failed");
    await expect(
      mapBatches({
        action: () => Promise.reject(failure),
        items: [1, 2, 3],
        size: 1,
      })
    ).rejects.toThrow(failure);
  });
});
