import { describe, expect, test } from "bun:test";

import type { Schemas } from "@qdrant/js-client-rest";

import {
  and,
  eq,
  exists,
  gt,
  gte,
  isIn,
  lt,
  lte,
  ne,
  not,
  notIn,
  or,
} from "../../src/filter/ast";
import { compileQdrantFilter } from "../../src/filter/qdrant";

describe(compileQdrantFilter, () => {
  test("eq on a keyword becomes a match condition", () => {
    expect(compileQdrantFilter(eq("genre", "drama"))).toStrictEqual({
      must: [{ key: "genre", match: { value: "drama" } }],
    });
  });

  test("eq on a float becomes a closed range", () => {
    expect(compileQdrantFilter(eq("price", 9.99))).toStrictEqual({
      must: [{ key: "price", range: { gte: 9.99, lte: 9.99 } }],
    });
  });

  test("eq on an integer and a boolean stay as match", () => {
    expect(compileQdrantFilter(eq("year", 2020))).toStrictEqual({
      must: [{ key: "year", match: { value: 2020 } }],
    });
    expect(compileQdrantFilter(eq("published", true))).toStrictEqual({
      must: [{ key: "published", match: { value: true } }],
    });
  });

  test("ne becomes must_not", () => {
    expect(compileQdrantFilter(ne("genre", "drama"))).toStrictEqual({
      must_not: [{ key: "genre", match: { value: "drama" } }],
    });
  });

  test("range operators map to range keys", () => {
    expect(compileQdrantFilter(gt("year", 2000))).toStrictEqual({
      must: [{ key: "year", range: { gt: 2000 } }],
    });
    expect(compileQdrantFilter(gte("year", 2000))).toStrictEqual({
      must: [{ key: "year", range: { gte: 2000 } }],
    });
    expect(compileQdrantFilter(lt("year", 2000))).toStrictEqual({
      must: [{ key: "year", range: { lt: 2000 } }],
    });
    expect(compileQdrantFilter(lte("year", 2000))).toStrictEqual({
      must: [{ key: "year", range: { lte: 2000 } }],
    });
  });

  test("in with homogeneous strings uses match.any", () => {
    expect(
      compileQdrantFilter(isIn("genre", ["drama", "comedy"]))
    ).toStrictEqual({
      must: [{ key: "genre", match: { any: ["drama", "comedy"] } }],
    });
  });

  test("in with mixed values falls back to should", () => {
    expect(compileQdrantFilter(isIn("tag", ["a", 1.5, true]))).toStrictEqual({
      should: [
        { key: "tag", match: { value: "a" } },
        { key: "tag", range: { gte: 1.5, lte: 1.5 } },
        { key: "tag", match: { value: true } },
      ],
    });
  });

  test("nin uses match.except or must_not", () => {
    expect(compileQdrantFilter(notIn("year", [1, 2]))).toStrictEqual({
      must: [{ key: "year", match: { except: [1, 2] } }],
    });
    expect(compileQdrantFilter(notIn("flag", [true, false]))).toStrictEqual({
      must_not: [
        { key: "flag", match: { value: true } },
        { key: "flag", match: { value: false } },
      ],
    });
  });

  test("exists negates is_empty", () => {
    expect(compileQdrantFilter(exists("genre"))).toStrictEqual({
      must_not: [{ is_empty: { key: "genre" } }],
    });
  });

  test("and, or and not nest", () => {
    const filter = and(
      eq("genre", "drama"),
      or(gt("year", 2000), not(exists("year")))
    );
    expect(compileQdrantFilter(filter)).toStrictEqual({
      must: [
        { key: "genre", match: { value: "drama" } },
        {
          should: [
            { key: "year", range: { gt: 2000 } },
            { must_not: [{ must_not: [{ is_empty: { key: "year" } }] }] },
          ],
        },
      ],
    });
  });

  test("output is assignable to the Qdrant SDK filter schema", () => {
    const native: Schemas["Filter"] = compileQdrantFilter(
      and(eq("a", 1), isIn("b", ["x"]), not(exists("c")))
    );
    expect(native.must).toHaveLength(3);
  });
});
