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
      params: ['{"genre":"drama"}', '{"genre":["drama"]}'],
      text: "(metadata @> $1::jsonb OR metadata @> $2::jsonb)",
    });
  });

  test("ne negates containment", () => {
    expect(compilePgvectorFilter(ne("year", 2020))).toStrictEqual({
      params: ['{"year":2020}', '{"year":[2020]}'],
      text: "NOT (metadata @> $1::jsonb OR metadata @> $2::jsonb)",
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

  test("in and nin match any value as a scalar or as a list element", () => {
    expect(compilePgvectorFilter(isIn("genre", ["a", "b"]))).toStrictEqual({
      params: [
        '{"genre":"a"}',
        '{"genre":["a"]}',
        '{"genre":"b"}',
        '{"genre":["b"]}',
      ],
      text: "(metadata @> $1::jsonb OR metadata @> $2::jsonb OR metadata @> $3::jsonb OR metadata @> $4::jsonb)",
    });
    expect(compilePgvectorFilter(notIn("genre", ["a"]))).toStrictEqual({
      params: ['{"genre":"a"}', '{"genre":["a"]}'],
      text: "NOT (metadata @> $1::jsonb OR metadata @> $2::jsonb)",
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
      "((metadata @> $1::jsonb OR metadata @> $2::jsonb) AND ((metadata @> $3::jsonb OR metadata @> $4::jsonb) OR NOT ((metadata @> $5::jsonb OR metadata @> $6::jsonb))))"
    );
    expect(sql.params).toStrictEqual([
      '{"a":1}',
      '{"a":[1]}',
      '{"b":2}',
      '{"b":[2]}',
      '{"c":3}',
      '{"c":[3]}',
    ]);
  });

  test("column and startIndex are configurable", () => {
    expect(
      compilePgvectorFilter(and(eq("a", 1), gt("b", 2)), {
        column: "t.meta",
        startIndex: 4,
      })
    ).toStrictEqual({
      params: ['{"a":1}', '{"a":[1]}', "b", "2"],
      text: "((t.meta @> $4::jsonb OR t.meta @> $5::jsonb) AND (jsonb_typeof((t.meta->$6::text)) = 'number' AND (t.meta->$6::text) > $7::jsonb))",
    });
  });
});
