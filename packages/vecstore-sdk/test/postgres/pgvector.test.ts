import { describe, expect, test } from "bun:test";

import type { PGlite } from "@electric-sql/pglite";

import { eq, gte, ne } from "../../src/filter/ast";
import { createPgvectorStore } from "../../src/pgvector";
import type { DeleteSelector } from "../../src/types";
import {
  containsCases,
  liveCases,
  negatedRangeCases,
  setupLive,
} from "../live/conformance";
import { emptySelector, filterWithoutValue } from "../malformed";
import {
  AVOID_INDEX_SCAN,
  ensureRoles,
  FORCE_INDEX_SCAN,
  isDescending,
  NEAREST_FIRST_ZERO_LAST,
  spreadRecords,
  usePostgres,
  zeroVectorRecords,
} from "./pglite";

describe("pgvector on PGlite", () => {
  const db = usePostgres();

  const live = setupLive(() => createPgvectorStore({ client: db() }), {
    isolated: true,
  });

  test.each([...containsCases, ...liveCases, ...negatedRangeCases])(
    "%s",
    async (_name, run) => {
      await expect(run(live())).resolves.toBeUndefined();
    }
  );
});

describe("index lifecycle on PGlite", () => {
  const db = usePostgres();

  test("recreating an index with a different metric changes ordering and scoring", async () => {
    const store = createPgvectorStore({ client: db() });

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

  test("a euclidean index named after an opclass keeps its metric", async () => {
    const store = createPgvectorStore({ client: db() });
    const name = "x_vector_cosine_ops";

    const created = await store.createIndex({
      dimension: 3,
      metric: "euclidean",
      name,
    });

    expect(created.ok).toBeTruthy();
    const index = store.index(name);
    await index.upsert([
      { id: "same", vector: [1, 0, 0] },
      { id: "far", vector: [-9, 0, 0] },
    ]);
    const result = await index.query({ topK: 2, vector: [1, 0, 0] });
    expect(
      result.ok && result.value.map((match) => [match.id, match.score])
    ).toStrictEqual([
      ["same", 0],
      ["far", 10],
    ]);
  });

  test("createIndex rejects a name over 49 bytes and creates nothing", async () => {
    const name = "a".repeat(50);
    const store = createPgvectorStore({ client: db() });
    const result = await store.createIndex({ dimension: 3, name });
    expect(!result.ok && result.error.kind).toBe("invalid_argument");

    const rows = await db().query<{ count: number }>(
      "select count(*) from pg_tables where tablename like 'aaaa%'"
    );

    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe("queries through the HNSW index on PGlite", () => {
  const db = usePostgres(async (client) => {
    const store = createPgvectorStore({ client });
    await store.createIndex({ dimension: 3, name: "filled" });
    await store
      .index("filled", { namespace: "tenant-a" })
      .upsert(spreadRecords("a"));
    await store
      .index("filled", { namespace: "tenant-b" })
      .upsert(spreadRecords("b"));
    await client.exec(FORCE_INDEX_SCAN);
  });

  const index = () =>
    createPgvectorStore({ client: db() }).index("filled", {
      namespace: "tenant-a",
    });

  test("a topK above the HNSW candidate list returns topK records, nearest first", async () => {
    const result = await index().query({ topK: 100, vector: [1, 0, 0] });
    const scores = result.ok ? result.value.map((match) => match.score) : [];
    expect(scores).toHaveLength(100);
    expect(isDescending(scores)).toBeTruthy();
  });

  test("a selective filter returns topK records", async () => {
    const result = await index().query({
      filter: eq("kind", "rare"),
      topK: 10,
      vector: [1, 0, 0],
    });

    expect(result.ok && result.value).toHaveLength(10);
  });

  test("the scan setting does not outlive the query", async () => {
    await index().query({ topK: 100, vector: [1, 0, 0] });
    const setting = await db().query("show hnsw.iterative_scan");
    expect(setting.rows).toStrictEqual([{ "hnsw.iterative_scan": "off" }]);
  });

  test("a scan mode set on the session is kept", async () => {
    await db().exec("set hnsw.iterative_scan = relaxed_order");
    const result = await index().query({ topK: 100, vector: [1, 0, 0] });
    const setting = await db().query("show hnsw.iterative_scan");
    await db().exec("reset hnsw.iterative_scan");
    expect(result.ok && result.value).toHaveLength(100);
    expect(setting.rows).toStrictEqual([
      { "hnsw.iterative_scan": "relaxed_order" },
    ]);
  });
});

describe("a cosine query that meets a zero vector on PGlite", () => {
  const db = usePostgres(async (client) => {
    const store = createPgvectorStore({ client });
    await store.createIndex({ dimension: 2, name: "wrapped" });
    await store.index("wrapped").upsert(zeroVectorRecords);
    await store.createIndex({ dimension: 2, name: "plain" });
    await client.exec('drop index "plain_embedding_idx"');
    await store.index("plain").upsert(zeroVectorRecords);
    await client.exec(AVOID_INDEX_SCAN);
  });

  test.each([["wrapped"], ["plain"]])(
    "ranks the zero vector last on the %s path",
    async (name) => {
      const result = await createPgvectorStore({ client: db() })
        .index(name)
        .query({ topK: 4, vector: [1, 0] });

      expect(result.ok && result.value.map((match) => match.id)).toStrictEqual(
        NEAREST_FIRST_ZERO_LAST
      );
    }
  );
});

describe("a store that met a missing table on PGlite", () => {
  const db = usePostgres();

  test("reads the metric again once another store creates the table", async () => {
    const early = createPgvectorStore({ client: db() });

    const missing = await early
      .index("late")
      .query({ topK: 1, vector: [1, 0, 0] });

    await createPgvectorStore({ client: db() }).createIndex({
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
  const db = usePostgres(async (client) => {
    const store = createPgvectorStore({ client });
    await store.createIndex({ dimension: 3, name: "guarded" });
    await store.index("guarded", { namespace: "tenant-a" }).upsert([
      {
        id: "a",
        metadata: { genre: "drama", year: 2000 },
        vector: [1, 0, 0],
      },
      { id: "b", metadata: { genre: "comedy" }, vector: [0, 1, 0] },
    ]);
  });

  test.each(refusedSelectors)("%s deletes nothing", async (_name, selector) => {
    const index = createPgvectorStore({ client: db() }).index("guarded", {
      namespace: "tenant-a",
    });

    const deleted = await index.delete(selector);
    const found = await index.fetch(["a", "b"]);
    expect(!deleted.ok && deleted.error.kind).toBe("invalid_argument");
    expect(found.ok && found.value.map((record) => record.id)).toStrictEqual([
      "a",
      "b",
    ]);
  });
});

const rowSecurity = async (
  db: PGlite,
  table: string
): Promise<boolean | undefined> => {
  const result = await db.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class where relname = $1",
    [table]
  );

  return result.rows[0]?.relrowsecurity;
};

describe("row level security without an anon role on PGlite", () => {
  const db = usePostgres();

  test("createIndex leaves row level security off", async () => {
    const store = createPgvectorStore({ client: db() });
    const created = await store.createIndex({ dimension: 3, name: "open" });
    expect(created.ok).toBe(true);
    expect(await rowSecurity(db(), "open")).toBe(false);
  });
});

describe("row level security with an anon role on PGlite", () => {
  const db = usePostgres((client) => ensureRoles(client, ["anon"]));

  test("createIndex turns row level security on", async () => {
    const store = createPgvectorStore({ client: db() });
    const created = await store.createIndex({ dimension: 3, name: "secured" });
    expect(created.ok).toBe(true);
    expect(await rowSecurity(db(), "secured")).toBe(true);
  });

  test("a role that is not a superuser keeps full access to the table it created", async () => {
    await ensureRoles(db(), ["app_owner"]);
    await db().exec(
      "create extension if not exists vector; grant create on schema public to app_owner; set role app_owner"
    );

    try {
      const store = createPgvectorStore({ client: db() });
      const created = await store.createIndex({ dimension: 3, name: "owned" });
      const index = store.index("owned");
      const upserted = await index.upsert([{ id: "a", vector: [1, 0, 0] }]);
      const found = await index.query({ topK: 1, vector: [1, 0, 0] });
      expect(created.ok && upserted.ok).toBe(true);
      expect(found.ok && found.value.map((match) => match.id)).toStrictEqual([
        "a",
      ]);
    } finally {
      await db().exec("reset role");
    }
  });

  test("anon reads nothing from the table without a policy", async () => {
    const store = createPgvectorStore({ client: db() });
    await store.createIndex({ dimension: 3, name: "hidden" });
    await store.index("hidden").upsert([{ id: "a", vector: [1, 0, 0] }]);
    await db().exec("grant select on hidden to anon; set role anon");

    try {
      const rows = await db().query<{ count: number }>(
        "select count(*) from hidden"
      );

      expect(rows.rows[0]?.count).toBe(0);
    } finally {
      await db().exec("reset role");
    }
  });
});
