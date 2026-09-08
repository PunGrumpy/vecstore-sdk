import { describe, expect, test } from "bun:test";

import { Pool } from "pg";

import type { VecstoreError } from "../../src/errors";
import { and, eq, gt } from "../../src/filter/ast";
import type { PgParam, PgQueryable } from "../../src/pgvector";
import {
  createPgvectorStore,
  normalizePgvectorError,
} from "../../src/pgvector";

interface Call {
  readonly text: string;
  readonly params: PgParam[];
}

const pgError = (code: string) => Object.assign(new Error(code), { code });

const fakeClient = (responses: object[][] = []) => {
  const calls: Call[] = [];
  const pending = [...responses];
  const client: PgQueryable = {
    query: (text, params) => {
      calls.push({ params, text });
      return Promise.resolve({ rows: pending.shift() ?? [] });
    },
  };
  return { calls, client };
};

const codeKinds: [string, VecstoreError["kind"]][] = [
  ["42P01", "not_found"],
  ["42P07", "already_exists"],
  ["22000", "invalid_argument"],
  ["23505", "invalid_argument"],
  ["42501", "unauthorized"],
  ["28P01", "unauthorized"],
  ["ECONNREFUSED", "connection"],
  ["08006", "connection"],
  ["XX000", "provider"],
];

describe(createPgvectorStore, () => {
  test("a pg Pool is accepted and returned as raw", () => {
    const client = new Pool({ connectionString: "postgres://x" });
    const raw: Pool = createPgvectorStore({ client }).raw;
    expect(raw).toBe(client);
  });

  test("createIndex creates the table, the HNSW index and a GIN index", async () => {
    const { client, calls } = fakeClient();
    const result = await createPgvectorStore({ client }).createIndex({
      dimension: 3,
      metric: "euclidean",
      name: "docs",
    });
    expect(result.ok).toBeTruthy();
    expect(calls.map((call) => call.text)).toStrictEqual([
      "CREATE EXTENSION IF NOT EXISTS vector",
      `CREATE TABLE "docs" (id text NOT NULL, namespace text NOT NULL DEFAULT '', embedding vector(3) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (namespace, id))`,
      `CREATE INDEX "docs_embedding_idx" ON "docs" USING hnsw (embedding vector_l2_ops)`,
      `CREATE INDEX "docs_metadata_idx" ON "docs" USING gin (metadata)`,
    ]);
  });

  test("createIndex rejects a non-integer dimension before touching the database", async () => {
    const { client, calls } = fakeClient();
    const result = await createPgvectorStore({ client }).createIndex({
      dimension: 1.5,
      name: "docs",
    });
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(calls).toHaveLength(0);
  });

  test("identifiers are quoted", async () => {
    const { client, calls } = fakeClient();
    await createPgvectorStore({ client, schema: "vec" }).deleteIndex(
      'weird"name'
    );
    expect(calls[0]?.text).toBe('DROP TABLE "vec"."weird""name"');
  });

  test("upsert batches rows into one INSERT ... ON CONFLICT", async () => {
    const { client, calls } = fakeClient();
    await createPgvectorStore({ client })
      .index("docs", { namespace: "tenant-a" })
      .upsert([
        { id: "a", metadata: { genre: "drama" }, vector: [1, 2] },
        { id: "b", vector: [3, 4] },
      ]);
    expect(calls[0]).toStrictEqual({
      params: [
        "a",
        "tenant-a",
        "[1,2]",
        '{"genre":"drama"}',
        "b",
        "tenant-a",
        "[3,4]",
        "{}",
      ],
      text: `INSERT INTO "docs" (id, namespace, embedding, metadata) VALUES ($1, $2, $3::vector, $4::jsonb), ($5, $6, $7::vector, $8::jsonb) ON CONFLICT (namespace, id) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata`,
    });
  });

  test("query resolves the metric once and compiles the filter", async () => {
    const { client, calls } = fakeClient([
      [
        {
          indexdef:
            "CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_ip_ops)",
        },
      ],
      [
        {
          embedding: "[1,2]",
          id: "a",
          metadata: { genre: "drama", year: 2001 },
          score: 0.75,
        },
      ],
    ]);
    const index = createPgvectorStore({ client }).index("docs");
    const result = await index.query({
      filter: and(eq("genre", "drama"), gt("year", 2000)),
      includeVector: true,
      topK: 3,
      vector: [1, 2],
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          id: "a",
          metadata: { genre: "drama", year: 2001 },
          score: 0.75,
          vector: [1, 2],
        },
      ],
    });
    expect(calls[1]).toStrictEqual({
      params: ["", "[1,2]", '{"genre":"drama"}', "year", "2000", 3],
      text: `SELECT id, metadata, embedding::text AS embedding, -(embedding <#> $2::vector) AS score FROM "docs" WHERE namespace = $1 AND (metadata @> $3::jsonb AND (jsonb_typeof((metadata->$4::text)) = 'number' AND (metadata->$4::text) > $5::jsonb)) ORDER BY embedding <#> $2::vector LIMIT $6`,
    });
    await index.query({ topK: 1, vector: [0, 0] });
    expect(calls).toHaveLength(3);
  });

  test("fetch and delete scope by namespace", async () => {
    const { client, calls } = fakeClient([
      [
        { id: "b", metadata: {} },
        { id: "a", metadata: { n: 1 } },
      ],
    ]);
    const index = createPgvectorStore({ client }).index("docs");
    await expect(index.fetch(["a", "b"])).resolves.toStrictEqual({
      ok: true,
      value: [
        { id: "a", metadata: { n: 1 }, vector: [] },
        { id: "b", metadata: {}, vector: [] },
      ],
    });
    await index.delete({ ids: ["a"] });
    await index.delete({ filter: eq("genre", "drama") });
    await index.delete({ all: true });
    expect(calls.map((call) => [call.text, call.params])).toStrictEqual([
      [
        `SELECT id, metadata FROM "docs" WHERE namespace = $1 AND id = ANY($2::text[])`,
        ["", ["a", "b"]],
      ],
      [
        `DELETE FROM "docs" WHERE namespace = $1 AND id = ANY($2::text[])`,
        ["", ["a"]],
      ],
      [
        `DELETE FROM "docs" WHERE namespace = $1 AND metadata @> $2::jsonb`,
        ["", '{"genre":"drama"}'],
      ],
      [`DELETE FROM "docs" WHERE namespace = $1`, [""]],
    ]);
  });

  test.each(codeKinds)("code %s becomes %s", (code, kind) => {
    expect(normalizePgvectorError(pgError(code), "docs").kind).toBe(kind);
  });

  test("an error without a code is a provider error", () => {
    expect(normalizePgvectorError(new Error("plain"), "docs").kind).toBe(
      "provider"
    );
  });
});
