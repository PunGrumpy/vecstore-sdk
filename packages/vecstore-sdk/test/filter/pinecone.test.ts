import { describe, expect, test } from "bun:test";

import type { Filter } from "../../src/filter/ast";
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
import type { PineconeFilter } from "../../src/filter/pinecone";
import { compilePineconeFilter } from "../../src/filter/pinecone";

const leaves: [string, Filter, PineconeFilter][] = [
  ["eq", eq("genre", "drama"), { genre: { $eq: "drama" } }],
  ["ne", ne("genre", "drama"), { genre: { $ne: "drama" } }],
  ["gt", gt("year", 2000), { year: { $gt: 2000 } }],
  ["gte", gte("year", 2000), { year: { $gte: 2000 } }],
  ["lt", lt("year", 2000), { year: { $lt: 2000 } }],
  ["lte", lte("year", 2000), { year: { $lte: 2000 } }],
  ["in", isIn("genre", ["a", "b"]), { genre: { $in: ["a", "b"] } }],
  ["nin", notIn("year", [1, 2]), { year: { $nin: [1, 2] } }],
  ["exists", exists("genre"), { genre: { $exists: true } }],
];

const negations: [string, Filter, PineconeFilter][] = [
  ["eq", not(eq("a", 1)), { a: { $ne: 1 } }],
  ["ne", not(ne("a", 1)), { a: { $eq: 1 } }],
  ["gt", not(gt("a", 1)), { a: { $lte: 1 } }],
  ["gte", not(gte("a", 1)), { a: { $lt: 1 } }],
  ["lt", not(lt("a", 1)), { a: { $gte: 1 } }],
  ["lte", not(lte("a", 1)), { a: { $gt: 1 } }],
  ["in", not(isIn("a", [1])), { a: { $nin: [1] } }],
  ["nin", not(notIn("a", [1])), { a: { $in: [1] } }],
  ["exists", not(exists("a")), { a: { $exists: false } }],
  [
    "and",
    not(and(eq("a", 1), eq("b", 2))),
    { $or: [{ a: { $ne: 1 } }, { b: { $ne: 2 } }] },
  ],
  [
    "or",
    not(or(eq("a", 1), eq("b", 2))),
    { $and: [{ a: { $ne: 1 } }, { b: { $ne: 2 } }] },
  ],
  ["not", not(not(eq("a", 1))), { a: { $eq: 1 } }],
];

describe(compilePineconeFilter, () => {
  test.each(leaves)("%s maps to its operator", (_name, filter, expected) => {
    expect(compilePineconeFilter(filter)).toStrictEqual(expected);
  });

  test("and and or map to $and and $or", () => {
    expect(
      compilePineconeFilter(and(eq("a", 1), or(eq("b", 2), eq("c", 3))))
    ).toStrictEqual({
      $and: [
        { a: { $eq: 1 } },
        { $or: [{ b: { $eq: 2 } }, { c: { $eq: 3 } }] },
      ],
    });
  });

  test.each(negations)(
    "not over %s is pushed down with De Morgan",
    (_name, filter, expected) => {
      expect(compilePineconeFilter(filter)).toStrictEqual(expected);
    }
  );

  test("in with booleans expands to equality clauses", () => {
    expect(compilePineconeFilter(isIn("flag", [true, "x"]))).toStrictEqual({
      $or: [{ flag: { $eq: true } }, { flag: { $eq: "x" } }],
    });
    expect(compilePineconeFilter(notIn("flag", [true, false]))).toStrictEqual({
      $and: [{ flag: { $ne: true } }, { flag: { $ne: false } }],
    });
  });
});
