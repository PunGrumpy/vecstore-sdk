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
import type { RedisMetadataField } from "../../src/filter/redis";
import { compileRedisFilter, escapeRedisTag } from "../../src/filter/redis";

const fields: RedisMetadataField[] = [
  { field: "genre", type: "tag" },
  { field: "tags", type: "tag" },
  { field: "wireless", type: "tag" },
  { field: "year", type: "numeric" },
];

const compiled = (filter: Filter): string => {
  const result = compileRedisFilter(filter, fields);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

const leaves: [string, Filter, string][] = [
  ["eq on a tag field", eq("genre", "drama"), '@genre:{"drama"}'],
  ["eq on a numeric field", eq("year", 1999), "@year:[1999 1999]"],
  ["eq on a boolean", eq("wireless", true), '@wireless:{"true"}'],
  ["ne on a tag field", ne("genre", "drama"), '-(@genre:{"drama"})'],
  ["gt", gt("year", 2000), "@year:[(2000 +inf]"],
  ["gte", gte("year", 2000), "@year:[2000 +inf]"],
  ["lt", lt("year", 2000), "@year:[-inf (2000]"],
  ["lte", lte("year", 2000), "@year:[-inf 2000]"],
  ["in on a tag field", isIn("genre", ["a", "b"]), '@genre:{"a" | "b"}'],
  [
    "in on a numeric field",
    isIn("year", [1999, 2010]),
    "(@year:[1999 1999] | @year:[2010 2010])",
  ],
  ["nin", notIn("genre", ["a"]), '-(@genre:{"a"})'],
  ["exists", exists("genre"), "-ismissing(@genre)"],
];

const negations: [string, Filter, string][] = [
  ["eq", not(eq("genre", "drama")), '-(@genre:{"drama"})'],
  ["ne", not(ne("genre", "drama")), '@genre:{"drama"}'],
  ["gt", not(gt("year", 2000)), "-(@year:[(2000 +inf])"],
  ["in", not(isIn("genre", ["a"])), '-(@genre:{"a"})'],
  ["nin", not(notIn("genre", ["a"])), '@genre:{"a"}'],
  ["exists", not(exists("genre")), "ismissing(@genre)"],
  ["not", not(not(eq("genre", "drama"))), '@genre:{"drama"}'],
  [
    "and",
    not(and(eq("genre", "drama"), gt("year", 2000))),
    '-((@genre:{"drama"} @year:[(2000 +inf]))',
  ],
];

const invalid: [string, Filter][] = [
  ["a field the schema has no room for", eq("director", "lynch")],
  ["a field the adapter keeps for itself", eq("namespace", "tenant-a")],
  ["a field name Redis cannot write", eq("user.name", "ada")],
  ["a number against a tag field", eq("genre", 7)],
  ["a string against a numeric field", eq("year", "1999")],
  ["a range over a tag field", gt("genre", 2000)],
  ["an infinite number", gt("year", Number.POSITIVE_INFINITY)],
  ["a membership that mixes types", isIn("year", [1999, "2010"])],
];

describe(compileRedisFilter, () => {
  test.each(leaves)("%s compiles to a query", (_name, filter, expected) => {
    expect(compiled(filter)).toBe(expected);
  });

  test.each(negations)("%s flips under not", (_name, filter, expected) => {
    expect(compiled(filter)).toBe(expected);
  });

  test("and joins clauses with a space", () => {
    expect(compiled(and(eq("genre", "drama"), gt("year", 2000)))).toBe(
      '(@genre:{"drama"} @year:[(2000 +inf])'
    );
  });

  test("or joins clauses with a pipe", () => {
    expect(compiled(or(eq("genre", "drama"), eq("genre", "comedy")))).toBe(
      '(@genre:{"drama"} | @genre:{"comedy"})'
    );
  });

  test("a nested group keeps its parentheses", () => {
    expect(
      compiled(
        and(eq("genre", "drama"), or(eq("year", 1999), eq("year", 2010)))
      )
    ).toBe('(@genre:{"drama"} (@year:[1999 1999] | @year:[2010 2010]))');
  });

  test.each(invalid)("%s is rejected", (_name, filter) => {
    const result = compileRedisFilter(filter, fields);
    expect(result).toMatchObject({
      error: { kind: "invalid_argument" },
      ok: false,
    });
  });

  test("a rejected filter names the field and the reason", () => {
    const result = compileRedisFilter(eq("director", "lynch"), fields);
    expect(result.ok === false && result.error.field).toBe("director");
    expect(result.ok === false && result.error.message).toContain(
      "metadataFields"
    );
  });
});

describe(escapeRedisTag, () => {
  test.each([
    ["plain", "drama", '"drama"'],
    ["a space", "film noir", '"film noir"'],
    ["punctuation", "sci-fi, fantasy", '"sci-fi, fantasy"'],
    ["a quote", 'the "good" one', '"the \\"good\\" one"'],
    ["a backslash", "a\\b", '"a\\\\b"'],
  ])("%s stays one tag", (_name, value, expected) => {
    expect(escapeRedisTag(value)).toBe(expected);
  });
});
