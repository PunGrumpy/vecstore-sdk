import { describe, expect, test } from "bun:test";

import { QdrantClient } from "@qdrant/js-client-rest";

import type { VecstoreError } from "../../src/errors";
import { eq } from "../../src/filter/ast";
import type {
  QdrantClientLike,
  QdrantFilter,
  QdrantPoint,
  QdrantScoredPoint,
  QdrantStoredPoint,
} from "../../src/qdrant";
import {
  createQdrantStore,
  normalizeQdrantError,
  scopeQdrantFilter,
} from "../../src/qdrant";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

interface Recorded {
  readonly createCollections: {
    name: string;
    vectors: { size: number; distance: string };
  }[];
  readonly payloadIndexes: string[];
  readonly deletes: (
    | { points: (string | number)[]; wait?: boolean }
    | { filter: QdrantFilter; wait?: boolean }
  )[];
  readonly queries: { filter?: QdrantFilter; limit: number; query: number[] }[];
  readonly upserts: QdrantPoint[][];
}

const fakeClient = () => {
  const stored: QdrantStoredPoint[] = [];
  const recorded: Recorded = {
    createCollections: [],
    deletes: [],
    payloadIndexes: [],
    queries: [],
    upserts: [],
  };
  const client: QdrantClientLike = {
    createCollection: (name, args) => {
      recorded.createCollections.push({ name, vectors: args.vectors });
      return Promise.resolve(true);
    },
    createPayloadIndex: (_name, args) => {
      recorded.payloadIndexes.push(args.field_name);
      return Promise.resolve({ status: "completed" });
    },
    delete: (_name, args) => {
      recorded.deletes.push(args);
      return Promise.resolve({ status: "completed" });
    },
    deleteCollection: () => Promise.resolve(true),
    getCollections: () =>
      Promise.resolve({ collections: [{ name: "a" }, { name: "b" }] }),
    query: (_name, args) => {
      recorded.queries.push({
        filter: args.filter,
        limit: args.limit,
        query: args.query,
      });
      const points: QdrantScoredPoint[] = stored.map((point) => ({
        ...point,
        score: 0.5,
      }));
      return Promise.resolve({ points });
    },
    retrieve: (_name, args) =>
      Promise.resolve(stored.filter((point) => args.ids.includes(point.id))),
    upsert: (_name, args) => {
      recorded.upserts.push(args.points);
      stored.push(...args.points);
      return Promise.resolve({ status: "completed" });
    },
  };
  return { client, recorded };
};

const defaultScope = {
  should: [
    { is_empty: { key: "_namespace" } },
    { key: "_namespace", match: { value: "" } },
  ],
};

const httpFailure = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

const statusKinds: [number, VecstoreError["kind"]][] = [
  [404, "not_found"],
  [409, "already_exists"],
  [400, "invalid_argument"],
  [422, "invalid_argument"],
  [401, "unauthorized"],
  [403, "unauthorized"],
  [500, "provider"],
];

describe(createQdrantStore, () => {
  test("the real QdrantClient is accepted and returned as raw", () => {
    const client = new QdrantClient({ url: "http://localhost:6333" });
    const raw: QdrantClient = createQdrantStore({ client }).raw;
    expect(raw).toBe(client);
  });

  test("createIndex creates the collection and a tenant index", async () => {
    const { client, recorded } = fakeClient();
    const result = await createQdrantStore({ client }).createIndex({
      dimension: 3,
      metric: "dot",
      name: "docs",
    });
    expect(result.ok).toBeTruthy();
    expect(recorded.createCollections).toStrictEqual([
      { name: "docs", vectors: { distance: "Dot", size: 3 } },
    ]);
    expect(recorded.payloadIndexes).toStrictEqual(["_namespace"]);
  });

  test("listIndexes returns collection names", async () => {
    const store = createQdrantStore({ client: fakeClient().client });
    await expect(store.listIndexes()).resolves.toStrictEqual({
      ok: true,
      value: ["a", "b"],
    });
  });

  test("upsert hashes non-UUID ids and keeps the original in the payload", async () => {
    const { client, recorded } = fakeClient();
    await createQdrantStore({ client })
      .index("docs")
      .upsert([
        { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
        { id: UUID, vector: [4, 5, 6] },
      ]);
    const [hashed, passthrough] = recorded.upserts[0] ?? [];
    expect(hashed?.id).not.toBe("doc-1");
    expect(hashed?.payload).toStrictEqual({ _id: "doc-1", genre: "drama" });
    expect(passthrough?.id).toBe(UUID);
    expect(passthrough?.payload).toStrictEqual({});
  });

  test("query and fetch return the caller's ids and strip reserved keys", async () => {
    const index = createQdrantStore({ client: fakeClient().client }).index(
      "docs",
      { namespace: "tenant-a" }
    );
    await index.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    await expect(
      index.query({ topK: 1, vector: [1, 2, 3] })
    ).resolves.toStrictEqual({
      ok: true,
      value: [
        {
          id: "doc-1",
          metadata: { genre: "drama" },
          score: 0.5,
          vector: [1, 2, 3],
        },
      ],
    });
    await expect(index.fetch(["missing", "doc-1"])).resolves.toStrictEqual({
      ok: true,
      value: [{ id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] }],
    });
  });

  test("query scopes the filter to the namespace", async () => {
    const { client, recorded } = fakeClient();
    await createQdrantStore({ client })
      .index("docs", { namespace: "tenant-a" })
      .query({ filter: eq("genre", "drama"), topK: 5, vector: [1] });
    expect(recorded.queries).toStrictEqual([
      {
        filter: {
          must: [
            { key: "_namespace", match: { value: "tenant-a" } },
            { must: [{ key: "genre", match: { value: "drama" } }] },
          ],
        },
        limit: 5,
        query: [1],
      },
    ]);
  });

  test("the default namespace matches points without a namespace", () => {
    expect(scopeQdrantFilter()).toStrictEqual({ must: [defaultScope] });
  });

  test("delete maps ids, filters and all", async () => {
    const { client, recorded } = fakeClient();
    const index = createQdrantStore({ client }).index("docs");
    await index.delete({ ids: [UUID] });
    await index.delete({ filter: eq("genre", "drama") });
    await index.delete({ all: true });
    expect(recorded.deletes).toStrictEqual([
      { points: [UUID], wait: true },
      {
        filter: {
          must: [
            defaultScope,
            { must: [{ key: "genre", match: { value: "drama" } }] },
          ],
        },
        wait: true,
      },
      { filter: { must: [defaultScope] }, wait: true },
    ]);
  });

  test.each(statusKinds)("HTTP %i becomes %s", (status, kind) => {
    expect(normalizeQdrantError(httpFailure(status), "docs").kind).toBe(kind);
  });

  test("a bad request carries the Qdrant error message", () => {
    const cause = Object.assign(new Error("Bad Request"), {
      data: { status: { error: "bad vector" } },
      status: 400,
    });
    expect(normalizeQdrantError(cause, "docs")).toStrictEqual({
      cause,
      kind: "invalid_argument",
      message: "bad vector",
      provider: "qdrant",
    });
  });

  test("a failed fetch is a connection error", () => {
    expect(
      normalizeQdrantError(new TypeError("fetch failed"), "docs").kind
    ).toBe("connection");
  });

  test("a failing call returns an error result instead of throwing", async () => {
    const cause = httpFailure(404);
    const failing: QdrantClientLike = {
      ...fakeClient().client,
      upsert: () => Promise.reject(cause),
    };
    const result = await createQdrantStore({ client: failing })
      .index("missing")
      .upsert([{ id: "x", vector: [1] }]);
    expect(result).toStrictEqual({
      error: {
        cause,
        kind: "not_found",
        message: 'Index "missing" was not found',
        name: "missing",
        provider: "qdrant",
        resource: "index",
      },
      ok: false,
    });
  });
});
