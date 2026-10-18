import { describe, expect, test } from "bun:test";

import {
  and,
  eq,
  exists,
  gt,
  isIn,
  lte,
  ne,
  not,
  notIn,
  or,
} from "../../src/filter/ast";
import type { Filter } from "../../src/filter/ast";
import { compilePgvectorFilter } from "../../src/filter/pgvector";
import { isString } from "../../src/internal/guards";
import { installSupabaseSql, usePostgres } from "./pglite";

const rows: [string, object][] = [
  ["a", { genre: "drama", tags: ["x", "y"], year: 1999 }],
  ["b", { genre: "comedy", tags: ["y"], year: 2010 }],
  ["c", { genre: "horror" }],
  ["d", { flag: true, genre: "drama", tags: [], year: 1.5 }],
];

const corpus: [string, Filter, string[] | undefined][] = [
  ["eq scalar", eq("genre", "drama"), ["a", "d"]],
  ["eq float", eq("year", 1.5), ["d"]],
  ["eq boolean", eq("flag", true), ["d"]],
  ["eq on a list field", eq("tags", "x"), ["a"]],
  ["ne", ne("genre", "drama"), ["b", "c"]],
  ["ne matches a missing field", ne("year", 1999), ["b", "c", "d"]],
  ["ne on a list field", ne("tags", "x"), ["b", "c", "d"]],
  ["gt", gt("year", 2000), ["b"]],
  ["lte", lte("year", 1999), ["a", "d"]],
  ["in scalar", isIn("genre", ["drama", "comedy"]), ["a", "b", "d"]],
  ["in on a list field", isIn("tags", ["x"]), ["a"]],
  ["in on a list field with an unused value", isIn("tags", ["x", "z"]), ["a"]],
  ["nin matches a missing field", notIn("genre", ["drama"]), ["b", "c"]],
  ["nin on a list field", notIn("tags", ["y"]), ["c", "d"]],
  ["exists", exists("tags"), ["a", "b", "d"]],
  ["not exists", not(exists("tags")), ["c"]],
  ["not gt matches a missing field", not(gt("year", 2000)), ["a", "c", "d"]],
  ["not lte matches a missing field", not(lte("year", 1999)), ["b", "c"]],
  [
    "not around an or of a range matches a missing field",
    not(or(gt("year", 2000), eq("genre", "comedy"))),
    ["a", "c", "d"],
  ],
  ["and", and(eq("genre", "drama"), gt("year", 1990)), ["a"]],
  ["or", or(eq("genre", "horror"), isIn("tags", ["y"])), ["a", "b", "c"]],
  ["not in", not(isIn("tags", ["x"])), ["b", "c", "d"]],
];

describe("the two pgvector filter compilers", () => {
  const db = usePostgres(async (client) => {
    await installSupabaseSql(client);
    await client.exec(
      `create table d (id text primary key, metadata jsonb not null)`
    );
    await Promise.all(
      rows.map(([id, metadata]) =>
        client.query(`insert into d values ($1, $2::jsonb)`, [
          id,
          JSON.stringify(metadata),
        ])
      )
    );
  });

  const idsFor = async (
    where: string,
    params: string[] = []
  ): Promise<string[]> => {
    const result = await db().query<{ id: string }>(
      `select id from d where ${where} order by id`,
      params
    );
    return result.rows.map((row) => row.id);
  };

  test.each(corpus)("%s", async (_name, filter, expected) => {
    const compiled = compilePgvectorFilter(filter);
    const fromTypescript = await idsFor(compiled.text, compiled.params);
    const sql = await db().query<{ s: string }>(
      `select vecstore_filter_sql($1::jsonb, 'metadata') as s`,
      [JSON.stringify(filter)]
    );
    const predicate = sql.rows[0]?.s;
    expect(isString(predicate) && predicate.length > 0).toBe(true);
    if (!isString(predicate)) {
      throw new Error("vecstore_filter_sql returned no predicate");
    }
    const fromPlpgsql = await idsFor(predicate);
    expect(fromPlpgsql).toStrictEqual(fromTypescript);
    if (expected !== undefined) {
      expect(fromTypescript).toStrictEqual(expected);
    }
  });
});
