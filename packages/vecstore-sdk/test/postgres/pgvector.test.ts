import { afterAll, describe, expect, test } from "bun:test";

import { createPgvectorStore } from "../../src/pgvector";
import { containsCases, liveCases, setupLive } from "../live/conformance";
import { createPostgres } from "./pglite";

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
