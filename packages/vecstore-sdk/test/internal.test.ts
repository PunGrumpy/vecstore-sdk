import { describe, expect, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

import { and, eq, exists, gt, isIn, lt, not, or } from "../src/filter/ast";
import type { Filter } from "../src/filter/ast";
import {
  chunk,
  lastById,
  mapBatches,
  sortByIds,
} from "../src/internal/collections";
import { deleteSelectorError } from "../src/internal/delete-selector";
import { filterError } from "../src/internal/filter";
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
import type { DeleteSelector } from "../src/types";
import { looseFilter, looseSelector } from "./malformed";

const acceptedSelectors: [string, DeleteSelector][] = [
  ["ids", { ids: ["a"] }],
  ["a filter", { filter: eq("genre", "drama") }],
  ["all", { all: true }],
];

const rejectedSelectors: [string, DeleteSelector][] = [
  ["an empty selector", looseSelector("{}")],
  ["all set to false", looseSelector('{"all":false}')],
  ["an empty id list", looseSelector('{"ids":[]}')],
  ["an id that is not a string", looseSelector('{"ids":[1]}')],
  ["a filter with a NaN bound", { filter: gt("year", Number.NaN) }],
];

const wellFormedFilters: [string, Filter][] = [
  ["a string equality", eq("genre", "drama")],
  ["a boolean equality", eq("published", true)],
  ["a float equality", eq("score", 0.5)],
  ["a range", gt("year", 2000)],
  ["a mixed membership list", isIn("tag", ["a", 1, false])],
  ["a presence test", exists("genre")],
  ["nested combinators", and(not(or(eq("a", 1), lt("b", 2))), exists("c"))],
];

const malformedFilters: [string, Filter][] = [
  ["a NaN range bound", gt("year", Number.NaN)],
  ["an infinite range bound", lt("year", Number.POSITIVE_INFINITY)],
  ["a NaN equality value", eq("year", Number.NaN)],
  ["a NaN inside a membership list", isIn("year", [1, Number.NaN])],
  ["a missing equality value", looseFilter('{"kind":"eq","field":"genre"}')],
  [
    "a null equality value",
    looseFilter('{"kind":"ne","field":"genre","value":null}'),
  ],
  [
    "a string range bound",
    looseFilter('{"kind":"gt","field":"year","value":"2005"}'),
  ],
  [
    "an empty membership list",
    looseFilter('{"kind":"in","field":"genre","values":[]}'),
  ],
  ["an empty and", looseFilter('{"kind":"and","filters":[]}')],
  ["a not without a child", looseFilter('{"kind":"not"}')],
  ["a missing field", looseFilter('{"kind":"eq","value":"drama"}')],
  [
    "an unknown kind",
    looseFilter('{"kind":"like","field":"genre","value":"dr"}'),
  ],
  [
    "a problem nested under not and or",
    not(or(eq("genre", "drama"), gt("year", Number.NaN))),
  ],
];

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

  test("starts no further batch once one has failed", async () => {
    const started: number[] = [];
    const items = Array.from({ length: 12 }, (_, index) => index);
    await expect(
      mapBatches({
        action: async (batch) => {
          started.push(...batch);
          await Promise.resolve();
          if (batch.includes(1)) {
            throw new Error("batch failed");
          }
          return batch;
        },
        concurrency: 2,
        items,
        size: 1,
      })
    ).rejects.toThrow("batch failed");
    const startedAtRejection = started.length;
    await sleep(20);
    expect(started).toHaveLength(startedAtRejection);
    expect(startedAtRejection).toBeLessThan(items.length);
  });

  test("lets batches already in flight finish before it rejects", async () => {
    const finished: number[] = [];
    await expect(
      mapBatches({
        action: async ([item]) => {
          if (item === 0) {
            throw new Error("first batch failed");
          }
          await sleep(10);
          finished.push(item ?? -1);
        },
        concurrency: 3,
        items: [0, 1, 2, 3, 4, 5],
        size: 1,
      })
    ).rejects.toThrow("first batch failed");
    expect(finished.toSorted()).toStrictEqual([1, 2]);
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

describe(filterError, () => {
  test.each(wellFormedFilters)("accepts %s", (_name, filter) => {
    expect(filterError("pgvector", filter)).toBeUndefined();
  });

  test.each(malformedFilters)("rejects %s", (_name, filter) => {
    expect(filterError("pgvector", filter)?.kind).toBe("invalid_argument");
  });

  test("names the field and the value it rejects", () => {
    const error = filterError("qdrant", gt("year", Number.NaN));
    expect(error?.provider).toBe("qdrant");
    expect(error?.message).toBe(
      '"gt" on "year" needs a finite number, received NaN.'
    );
  });
});

describe("queryOptionsError with a filter", () => {
  test("rejects a malformed filter and accepts a well formed one", () => {
    expect(
      queryOptionsError("qdrant", {
        filter: gt("year", Number.NaN),
        topK: 1,
        vector: [1],
      })?.kind
    ).toBe("invalid_argument");
    expect(
      queryOptionsError("qdrant", {
        filter: gt("year", 2000),
        topK: 1,
        vector: [1],
      })
    ).toBeUndefined();
  });
});

describe(deleteSelectorError, () => {
  test.each(acceptedSelectors)("accepts %s", (_name, selector) => {
    expect(deleteSelectorError("pgvector", selector)).toBeUndefined();
  });

  test.each(rejectedSelectors)("rejects %s", (_name, selector) => {
    expect(deleteSelectorError("pgvector", selector)?.kind).toBe(
      "invalid_argument"
    );
  });
});
