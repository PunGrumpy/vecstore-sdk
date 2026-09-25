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

const UPSERT_BATCH = 500;
const UPSERT_COLUMNS = 4;

const pgError = (code: string) => Object.assign(new Error(code), { code });

const fakeClient = (responses: object[][] = [], failures = 0) => {
  const calls: Call[] = [];
  const pending = [...responses];
  let remaining = failures;
  const client: PgQueryable = {
    query: (text, params) => {
      calls.push({ params, text });
      if (remaining > 0) {
        remaining -= 1;
        return Promise.reject(pgError("XX000"));
      }
      return Promise.resolve({ rows: pending.shift() ?? [] });
    },
  };
  return { calls, client };
};

const catalogCalls = (calls: readonly Call[]): number =>
  calls.filter((call) => call.text.startsWith("SELECT indexdef")).length;

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
    expect(calls).toHaveLength(1);
    const statement = calls[0]?.text ?? "";
    expect(
      statement.startsWith(
        "DO $vecstore$ BEGIN CREATE EXTENSION IF NOT EXISTS vector;"
      )
    ).toBeTruthy();
    expect(statement).toContain(
      `CREATE TABLE "docs" (id text NOT NULL, namespace text NOT NULL DEFAULT '', embedding vector(3) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (namespace, id))`
    );
    expect(statement).toContain(
      `CREATE INDEX "docs_embedding_idx" ON "docs" USING hnsw (embedding vector_l2_ops)`
    );
    expect(statement).toContain(
      `CREATE INDEX "docs_metadata_idx" ON "docs" USING gin (metadata)`
    );
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

  test("createIndex rejects a name longer than 49 bytes before touching the database", async () => {
    const { client, calls } = fakeClient();
    const store = createPgvectorStore({ client });
    const tooLong = await store.createIndex({
      dimension: 2,
      name: "a".repeat(50),
    });
    expect(!tooLong.ok && tooLong.error.kind).toBe("invalid_argument");
    expect(calls).toHaveLength(0);

    const atLimit = await store.createIndex({
      dimension: 2,
      name: "a".repeat(49),
    });
    expect(atLimit.ok).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  test("createIndex rejects a name that holds the dollar tag", async () => {
    const { client, calls } = fakeClient();
    const result = await createPgvectorStore({ client }).createIndex({
      dimension: 2,
      name: "x$vecstore$y",
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

  test("upsert keeps the last record when a batch repeats an id", async () => {
    const { client, calls } = fakeClient();
    await createPgvectorStore({ client })
      .index("docs")
      .upsert([
        { id: "a", vector: [1] },
        { id: "a", vector: [2] },
      ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toStrictEqual(["a", "", "[2]", "{}"]);
    expect(calls[0]?.text).toStartWith(
      `INSERT INTO "docs" (id, namespace, embedding, metadata) VALUES ($1, $2, $3::vector, $4::jsonb) ON CONFLICT`
    );
  });

  test("upsert restarts placeholder numbering in every batch", async () => {
    const { client, calls } = fakeClient();
    await createPgvectorStore({ client })
      .index("docs")
      .upsert(
        Array.from({ length: UPSERT_BATCH + 1 }, (_, i) => ({
          id: `r${i}`,
          vector: [i],
        }))
      );
    expect(calls).toHaveLength(2);
    expect(calls[1]?.params).toHaveLength(UPSERT_COLUMNS);
    expect(calls[1]?.text).toStartWith(
      `INSERT INTO "docs" (id, namespace, embedding, metadata) VALUES ($1, $2, $3::vector, $4::jsonb) ON CONFLICT`
    );
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
    const store = createPgvectorStore({ client });
    const result = await store.index("docs").query({
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
      params: [
        "",
        "[1,2]",
        '{"genre":"drama"}',
        '{"genre":["drama"]}',
        "year",
        "2000",
        3,
      ],
      text: `SELECT id, metadata, embedding::text AS embedding, -(embedding <#> $2::vector) AS score FROM "docs" WHERE namespace = $1 AND ((metadata @> $3::jsonb OR metadata @> $4::jsonb) AND (jsonb_typeof((metadata->$5::text)) = 'number' AND (metadata->$5::text) > $6::jsonb)) ORDER BY embedding <#> $2::vector LIMIT $7`,
    });
    await store.index("docs").query({ topK: 1, vector: [0, 0] });
    expect(calls).toHaveLength(3);
  });

  test("query rejects a non-positive topK before calling the provider", async () => {
    const { client, calls } = fakeClient();
    const result = await createPgvectorStore({ client })
      .index("docs")
      .query({ topK: 0, vector: [1] });
    expect(result.ok).toBeFalsy();
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(calls).toStrictEqual([]);
  });

  test("createIndex after deleteIndex re-reads the metric", async () => {
    const ipOpsRow = {
      indexdef:
        "CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_ip_ops)",
    };
    const l2OpsRow = {
      indexdef:
        "CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_l2_ops)",
    };
    const { client, calls } = fakeClient([
      [ipOpsRow],
      [],
      [],
      [],
      [l2OpsRow],
      [],
    ]);
    const store = createPgvectorStore({ client });
    await store.index("docs").query({ topK: 1, vector: [1, 2] });
    await store.deleteIndex("docs");
    await store.createIndex({
      dimension: 2,
      metric: "euclidean",
      name: "docs",
    });
    await store.index("docs").query({ topK: 1, vector: [1, 2] });
    expect(catalogCalls(calls)).toBe(2);
    expect(calls.at(-1)?.text).toContain("ORDER BY embedding <-> $2::vector");
  });

  test("a query before createIndex does not pin the cosine fallback", async () => {
    const l2OpsRow = {
      indexdef:
        "CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_l2_ops)",
    };
    const { client, calls } = fakeClient([[], [], [], [l2OpsRow], []]);
    const store = createPgvectorStore({ client });
    await store.index("docs").query({ topK: 1, vector: [1, 2] });
    await store.createIndex({
      dimension: 2,
      metric: "euclidean",
      name: "docs",
    });
    await store.index("docs").query({ topK: 1, vector: [1, 2] });
    expect(catalogCalls(calls)).toBe(2);
    expect(calls.at(-1)?.text).toContain("ORDER BY embedding <-> $2::vector");
  });

  test("the metric is resolved once even when the first two queries run together", async () => {
    const { client, calls } = fakeClient([
      [
        {
          indexdef:
            "CREATE INDEX docs_embedding_idx ON public.docs USING hnsw (embedding vector_ip_ops)",
        },
      ],
    ]);
    const store = createPgvectorStore({ client });
    await Promise.all([
      store.index("docs").query({ topK: 1, vector: [1, 2] }),
      store.index("docs").query({ topK: 1, vector: [3, 4] }),
    ]);
    expect(catalogCalls(calls)).toBe(1);
    expect(calls).toHaveLength(3);
  });

  test("a failed metric lookup is retried on the next query", async () => {
    const { client, calls } = fakeClient([], 1);
    const index = createPgvectorStore({ client }).index("docs");
    const failed = await index.query({ topK: 1, vector: [1, 2] });
    expect(failed).toMatchObject({ ok: false });
    const retried = await index.query({ topK: 1, vector: [1, 2] });
    expect(retried.ok).toBeTruthy();
    expect(catalogCalls(calls)).toBe(2);
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
        `DELETE FROM "docs" WHERE namespace = $1 AND (metadata @> $2::jsonb OR metadata @> $3::jsonb)`,
        ["", '{"genre":"drama"}', '{"genre":["drama"]}'],
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
