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
import type { VectorizeFilter } from "../../src/filter/vectorize";
import { compileVectorizeFilter } from "../../src/filter/vectorize";

const compiled = (filter: Filter): VectorizeFilter => {
  const result = compileVectorizeFilter(filter);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const leaves: [string, Filter, VectorizeFilter][] = [
  ["eq", eq("genre", "drama"), { genre: { $eq: "drama" } }],
  ["ne", ne("genre", "drama"), { genre: { $ne: "drama" } }],
  ["gt", gt("year", 2000), { year: { $gt: 2000 } }],
  ["gte", gte("year", 2000), { year: { $gte: 2000 } }],
  ["lt", lt("year", 2000), { year: { $lt: 2000 } }],
  ["lte", lte("year", 2000), { year: { $lte: 2000 } }],
  ["in", isIn("genre", ["a", "b"]), { genre: { $in: ["a", "b"] } }],
  ["nin", notIn("year", [1, 2]), { year: { $nin: [1, 2] } }],
];

const negations: [string, Filter, VectorizeFilter][] = [
  ["eq", not(eq("a", 1)), { a: { $ne: 1 } }],
  ["ne", not(ne("a", 1)), { a: { $eq: 1 } }],
  ["gt", not(gt("a", 1)), { a: { $lte: 1 } }],
  ["gte", not(gte("a", 1)), { a: { $lt: 1 } }],
  ["lt", not(lt("a", 1)), { a: { $gte: 1 } }],
  ["lte", not(lte("a", 1)), { a: { $gt: 1 } }],
  ["in", not(isIn("a", [1])), { a: { $nin: [1] } }],
  ["nin", not(notIn("a", [1])), { a: { $in: [1] } }],
  ["not", not(not(eq("a", 1))), { a: { $eq: 1 } }],
  ["or", not(or(eq("a", 1), eq("b", 2))), { a: { $ne: 1 }, b: { $ne: 2 } }],
];

const unsupported: [string, Filter, string][] = [
  ["or", or(eq("a", 1), eq("b", 2)), "orFilter"],
  ["negated and", not(and(eq("a", 1), eq("b", 2))), "orFilter"],
  ["or nested in and", and(eq("a", 1), or(eq("b", 2), eq("c", 3))), "orFilter"],
  ["exists", exists("genre"), "existsFilter"],
  ["negated exists", not(exists("genre")), "existsFilter"],
];

const invalid: [string, Filter][] = [
  ["the same operator twice", and(eq("a", 1), eq("a", 2))],
  ["a membership and a comparison", and(isIn("a", [1]), gt("a", 2))],
  ["a comparison and a membership", and(gt("a", 2), isIn("a", [1]))],
  ["the same membership twice", and(isIn("a", [1]), isIn("a", [2]))],
];

describe(compileVectorizeFilter, () => {
  test.each(leaves)("%s maps to its operator", (_name, filter, expected) => {
    expect(compiled(filter)).toStrictEqual(expected);
  });

  test.each(negations)(
    "not over %s is pushed down with De Morgan",
    (_name, filter, expected) => {
      expect(compiled(filter)).toStrictEqual(expected);
    }
  );

  test("and flattens into one object of fields", () => {
    expect(
      compiled(and(eq("genre", "drama"), gt("year", 2000), lt("year", 2010)))
    ).toStrictEqual({
      genre: { $eq: "drama" },
      year: { $gt: 2000, $lt: 2010 },
    });
  });

  test("a boolean stays a boolean in every operator", () => {
    expect(
      compiled(and(eq("flag", true), isIn("mode", [false])))
    ).toStrictEqual({ flag: { $eq: true }, mode: { $in: [false] } });
  });

  test.each(unsupported)("%s is unsupported", (_name, filter, feature) => {
    const result = compileVectorizeFilter(filter);
    expect(result).toMatchObject({
      error: { feature, kind: "unsupported" },
      ok: false,
    });
  });

  test.each(invalid)("one field cannot hold %s", (_name, filter) => {
    const result = compileVectorizeFilter(filter);
    expect(result).toMatchObject({
      error: { kind: "invalid_argument" },
      ok: false,
    });
  });

  test("an unsupported branch reports the reason", () => {
    const result = compileVectorizeFilter(or(eq("a", 1), eq("b", 2)));
    expect(result.ok === false && result.error.message).toContain(
      "no OR operator"
    );
  });
});
