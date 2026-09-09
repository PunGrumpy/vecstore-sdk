import { describe, expect, test } from "bun:test";

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
import { compilePgvectorFilter } from "../../src/filter/pgvector";

describe(compilePgvectorFilter, () => {
  test("eq uses JSONB containment", () => {
    expect(compilePgvectorFilter(eq("genre", "drama"))).toStrictEqual({
      params: ['{"genre":"drama"}'],
      text: "metadata @> $1::jsonb",
    });
  });

  test("ne negates containment", () => {
    expect(compilePgvectorFilter(ne("year", 2020))).toStrictEqual({
      params: ['{"year":2020}'],
      text: "NOT (metadata @> $1::jsonb)",
    });
  });

  test("range operators guard on the JSON type and compare as jsonb", () => {
    expect(compilePgvectorFilter(gt("year", 2000))).toStrictEqual({
      params: ["year", "2000"],
      text: "(jsonb_typeof((metadata->$1::text)) = 'number' AND (metadata->$1::text) > $2::jsonb)",
    });
    expect(compilePgvectorFilter(gte("year", 2000)).text).toContain(" >= ");
    expect(compilePgvectorFilter(lt("year", 2000)).text).toContain(" < ");
    expect(compilePgvectorFilter(lte("year", 2000)).text).toContain(" <= ");
  });

  test("in and nin use array containment", () => {
    expect(compilePgvectorFilter(isIn("genre", ["a", "b"]))).toStrictEqual({
      params: ["genre", '["a","b"]'],
      text: "(metadata->$1::text) <@ $2::jsonb",
    });
    expect(compilePgvectorFilter(notIn("genre", ["a"]))).toStrictEqual({
      params: ["genre", '["a"]'],
      text: "NOT COALESCE((metadata->$1::text) <@ $2::jsonb, false)",
    });
  });

  test("exists rejects missing keys and JSON null", () => {
    expect(compilePgvectorFilter(exists("genre"))).toStrictEqual({
      params: ["genre"],
      text: "((metadata->$1::text) IS NOT NULL AND jsonb_typeof((metadata->$1::text)) <> 'null')",
    });
  });

  test("and, or and not compose with parentheses", () => {
    const sql = compilePgvectorFilter(
      and(eq("a", 1), or(eq("b", 2), not(eq("c", 3))))
    );
    expect(sql.text).toBe(
      "(metadata @> $1::jsonb AND (metadata @> $2::jsonb OR NOT (metadata @> $3::jsonb)))"
    );
    expect(sql.params).toStrictEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  test("column and startIndex are configurable", () => {
    expect(
      compilePgvectorFilter(and(eq("a", 1), gt("b", 2)), {
        column: "t.meta",
        startIndex: 4,
      })
    ).toStrictEqual({
      params: ['{"a":1}', "b", "2"],
      text: "(t.meta @> $4::jsonb AND (jsonb_typeof((t.meta->$5::text)) = 'number' AND (t.meta->$5::text) > $6::jsonb))",
    });
  });
});
