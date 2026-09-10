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
import {
  compileUpstashFilter,
  isUpstashFilterError,
} from "../../src/filter/upstash";

const leaves: [string, Filter, string][] = [
  ["eq", eq("genre", "drama"), "genre = 'drama'"],
  ["ne", ne("genre", "drama"), "genre != 'drama'"],
  ["gt", gt("year", 2000), "year > 2000"],
  ["gte", gte("year", 2000), "year >= 2000"],
  ["lt", lt("year", 2000), "year < 2000"],
  ["lte", lte("year", 2000), "year <= 2000"],
  ["in", isIn("genre", ["a", "b"]), "genre IN ('a', 'b')"],
  ["nin", notIn("year", [1, 2]), "year NOT IN (1, 2)"],
  ["exists", exists("genre"), "HAS FIELD genre"],
];

const negations: [string, Filter, string][] = [
  ["eq", not(eq("a", 1)), "a != 1"],
  ["ne", not(ne("a", 1)), "a = 1"],
  ["gt", not(gt("a", 1)), "a <= 1"],
  ["gte", not(gte("a", 1)), "a < 1"],
  ["lt", not(lt("a", 1)), "a >= 1"],
  ["lte", not(lte("a", 1)), "a > 1"],
  ["in", not(isIn("a", [1])), "a NOT IN (1)"],
  ["nin", not(notIn("a", [1])), "a IN (1)"],
  ["exists", not(exists("a")), "HAS NOT FIELD a"],
  ["and", not(and(eq("a", 1), eq("b", 2))), "(a != 1 OR b != 2)"],
  ["or", not(or(eq("a", 1), eq("b", 2))), "(a != 1 AND b != 2)"],
  ["not", not(not(eq("a", 1))), "a = 1"],
];

const literals: [string, Filter, string][] = [
  ["boolean true", eq("flag", true), "flag = true"],
  ["boolean false", eq("flag", false), "flag = false"],
  ["negative number", gt("delta", -1.5), "delta > -1.5"],
  ["apostrophe", eq("city", "Cote d'Or"), 'city = "Cote d\'Or"'],
  ["double quote", eq("title", 'the "one"'), "title = 'the \"one\"'"],
  ["nested field", eq("economy.currency", "TRY"), "economy.currency = 'TRY'"],
  ["array element", eq("tags[0]", "x"), "tags[0] = 'x'"],
];

const rejected: [string, Filter][] = [
  ["a field with a space", eq("my field", 1)],
  ["a field starting with a digit", eq("1field", 1)],
  ["a field with a quote", eq("a'b", 1)],
  ["a value with a backslash", eq("label", "a\\b")],
  ["a value with both quotes", eq("quip", `it's "fine"`)],
  ["a non-finite number", gt("score", Number.POSITIVE_INFINITY)],
];

describe(compileUpstashFilter, () => {
  test.each(leaves)("%s maps to its operator", (_name, filter, expected) => {
    expect(compileUpstashFilter(filter)).toBe(expected);
  });

  test.each(negations)(
    "not over %s is pushed down with De Morgan",
    (_name, filter, expected) => {
      expect(compileUpstashFilter(filter)).toBe(expected);
    }
  );

  test.each(literals)(
    "%s is written as a literal",
    (_name, filter, expected) => {
      expect(compileUpstashFilter(filter)).toBe(expected);
    }
  );

  test("and and or group with parentheses", () => {
    expect(
      compileUpstashFilter(and(eq("a", 1), or(eq("b", 2), eq("c", 3))))
    ).toBe("(a = 1 AND (b = 2 OR c = 3))");
  });

  test.each(rejected)("%s is rejected", (_name, filter) => {
    expect(() => compileUpstashFilter(filter)).toThrow();
    try {
      compileUpstashFilter(filter);
    } catch (error) {
      expect(isUpstashFilterError(error)).toBe(true);
    }
  });

  test("errors from other sources are not filter errors", () => {
    expect(isUpstashFilterError(new Error("boom"))).toBe(false);
    expect(isUpstashFilterError("boom")).toBe(false);
  });
});
