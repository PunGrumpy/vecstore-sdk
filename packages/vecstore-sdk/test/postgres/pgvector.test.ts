import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq, gte, ne } from "../../src/filter/ast";
import { createPgvectorStore } from "../../src/pgvector";
import type { DeleteSelector } from "../../src/types";
import { containsCases, liveCases, setupLive } from "../live/conformance";
import { emptySelector, filterWithoutValue } from "../malformed";
import {
  createPostgres,
  FORCE_INDEX_SCAN,
  isDescending,
  spreadRecords,
} from "./pglite";

describe("pgvector on PGlite", () => {
  const db = createPostgres();
  const live = setupLive(() => createPgvectorStore({ client: db }));
  afterAll(() => db.close());

  test.each([...containsCases, ...liveCases])("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});

describe("index lifecycle on PGlite", () => {
  const db = createPostgres();
  const store = createPgvectorStore({ client: db });
  afterAll(() => db.close());

  test("recreating an index with a different metric changes ordering and scoring", async () => {
    const created = await store.createIndex({
      dimension: 3,
      name: "docs_cosine",
    });
    expect(created.ok).toBeTruthy();
    await store.index("docs_cosine").query({ topK: 1, vector: [1, 0, 0] });

    const deleted = await store.deleteIndex("docs_cosine");
    expect(deleted.ok).toBeTruthy();

    const recreated = await store.createIndex({
      dimension: 3,
      metric: "euclidean",
      name: "docs_cosine",
    });
    expect(recreated.ok).toBeTruthy();

    const index = store.index("docs_cosine");
    await index.upsert([
      { id: "a", vector: [1, 0, 0] },
      { id: "b", vector: [0, 1, 0] },
    ]);
    const result = await index.query({ topK: 2, vector: [1, 0, 0] });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value[0]?.score).toBe(0);
    }
  });

  test("createIndex rejects a name over 49 bytes and creates nothing", async () => {
    const name = "a".repeat(50);
    const result = await store.createIndex({ dimension: 3, name });
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    const rows = await db.query<{ count: number }>(
      "select count(*) from pg_tables where tablename like 'aaaa%'"
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe("queries through the HNSW index on PGlite", () => {
  const db = createPostgres();
  const store = createPgvectorStore({ client: db });
  const index = store.index("filled", { namespace: "tenant-a" });
  beforeAll(async () => {
    await store.createIndex({ dimension: 3, name: "filled" });
    await index.upsert(spreadRecords("a"));
    await store
      .index("filled", { namespace: "tenant-b" })
      .upsert(spreadRecords("b"));
    await db.exec(FORCE_INDEX_SCAN);
  });
  afterAll(() => db.close());

  test("a topK above the HNSW candidate list returns topK records, nearest first", async () => {
    const result = await index.query({ topK: 100, vector: [1, 0, 0] });
    const scores = result.ok ? result.value.map((match) => match.score) : [];
    expect(scores).toHaveLength(100);
    expect(isDescending(scores)).toBeTruthy();
  });

  test("a selective filter returns topK records", async () => {
    const result = await index.query({
      filter: eq("kind", "rare"),
      topK: 10,
      vector: [1, 0, 0],
    });
    expect(result.ok && result.value).toHaveLength(10);
  });

  test("the scan setting does not outlive the query", async () => {
    await index.query({ topK: 100, vector: [1, 0, 0] });
    const setting = await db.query("show hnsw.iterative_scan");
    expect(setting.rows).toStrictEqual([{ "hnsw.iterative_scan": "off" }]);
  });

  test("a scan mode set on the session is kept", async () => {
    await db.exec("set hnsw.iterative_scan = relaxed_order");
    const result = await index.query({ topK: 100, vector: [1, 0, 0] });
    const setting = await db.query("show hnsw.iterative_scan");
    await db.exec("reset hnsw.iterative_scan");
    expect(result.ok && result.value).toHaveLength(100);
    expect(setting.rows).toStrictEqual([
      { "hnsw.iterative_scan": "relaxed_order" },
    ]);
  });
});

describe("a store that met a missing table on PGlite", () => {
  const db = createPostgres();
  afterAll(() => db.close());

  test("reads the metric again once another store creates the table", async () => {
    const early = createPgvectorStore({ client: db });
    const missing = await early
      .index("late")
      .query({ topK: 1, vector: [1, 0, 0] });
    await createPgvectorStore({ client: db }).createIndex({
      dimension: 3,
      metric: "euclidean",
      name: "late",
    });
    await early.index("late").upsert([{ id: "a", vector: [1, 0, 0] }]);
    const found = await early
      .index("late")
      .query({ topK: 1, vector: [1, 0, 0] });
    expect(!missing.ok && missing.error.kind).toBe("not_found");
    expect(found.ok && found.value[0]?.score).toBe(0);
  });
});

const refusedSelectors: [string, DeleteSelector][] = [
  ["a NaN range bound", { filter: gte("year", Number.NaN) }],
  ["a NaN inequality", { filter: ne("genre", Number.NaN) }],
  ["an equality without a value", { filter: filterWithoutValue }],
  ["an empty selector", emptySelector],
];

describe("delete fails closed on PGlite", () => {
  const db = createPostgres();
  const store = createPgvectorStore({ client: db });
  const index = store.index("guarded", { namespace: "tenant-a" });
  beforeAll(async () => {
    await store.createIndex({ dimension: 3, name: "guarded" });
    await index.upsert([
      { id: "a", metadata: { genre: "drama", year: 2000 }, vector: [1, 0, 0] },
      { id: "b", metadata: { genre: "comedy" }, vector: [0, 1, 0] },
    ]);
  });
  afterAll(() => db.close());

  test.each(refusedSelectors)("%s deletes nothing", async (_name, selector) => {
    const deleted = await index.delete(selector);
    const found = await index.fetch(["a", "b"]);
    expect(!deleted.ok && deleted.error.kind).toBe("invalid_argument");
    expect(found.ok && found.value.map((record) => record.id)).toStrictEqual([
      "a",
      "b",
    ]);
  });
});
