import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
import { createPostgres, installSupabaseSql } from "./pglite";

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
  ["eq on a list field", eq("tags", "x"), undefined],
  ["ne", ne("genre", "drama"), ["b", "c"]],
  ["ne matches a missing field", ne("year", 1999), ["b", "c", "d"]],
  ["gt", gt("year", 2000), ["b"]],
  ["lte", lte("year", 1999), ["a", "d"]],
  ["in scalar", isIn("genre", ["drama", "comedy"]), ["a", "b", "d"]],
  ["in on a list field", isIn("tags", ["x"]), undefined],
  ["nin matches a missing field", notIn("genre", ["drama"]), ["b", "c"]],
  ["exists", exists("tags"), ["a", "b", "d"]],
  ["not exists", not(exists("tags")), ["c"]],
  ["and", and(eq("genre", "drama"), gt("year", 1990)), ["a"]],
  ["or", or(eq("genre", "horror"), isIn("tags", ["y"])), undefined],
  ["not in", not(isIn("tags", ["x"])), undefined],
];

describe("the two pgvector filter compilers", () => {
  const db = createPostgres();
  beforeAll(async () => {
    await installSupabaseSql(db);
    await db.exec(
      `create table d (id text primary key, metadata jsonb not null)`
    );
    await Promise.all(
      rows.map(([id, metadata]) =>
        db.query(`insert into d values ($1, $2::jsonb)`, [
          id,
          JSON.stringify(metadata),
        ])
      )
    );
  });
  afterAll(() => db.close());

  const idsFor = async (
    where: string,
    params: string[] = []
  ): Promise<string[]> => {
    const result = await db.query<{ id: string }>(
      `select id from d where ${where} order by id`,
      params
    );
    return result.rows.map((row) => row.id);
  };

  test.each(corpus)("%s", async (_name, filter, expected) => {
    const compiled = compilePgvectorFilter(filter);
    const fromTypescript = await idsFor(compiled.text, compiled.params);
    const sql = await db.query<{ s: string }>(
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
