import { describe, expect, test } from "bun:test";

import { Index } from "@upstash/vector";

import type { VecstoreError } from "../../src/errors";
import { eq } from "../../src/filter/ast";
import type {
  UpstashIndexLike,
  UpstashInfo,
  UpstashNamespaceOptions,
  UpstashRecordLike,
  UpstashScoredRecord,
  UpstashStoredRecord,
} from "../../src/upstash";
import {
  createUpstashStore,
  normalizeUpstashError,
  scopeUpstashFilter,
} from "../../src/upstash";

const upstashError = (message: string) =>
  Object.assign(new Error(message), { name: "UpstashError" });

const DEFAULT_INFO: UpstashInfo = {
  dimension: 3,
  similarityFunction: "COSINE",
};

interface Recorded {
  readonly deletes: {
    args: { ids: string[] } | { filter: string };
    namespace?: string;
  }[];
  readonly deletedNamespaces: string[];
  readonly fetches: { ids: string[]; namespace?: string }[];
  readonly resets: (string | undefined)[];
  readonly queries: {
    filter?: string;
    includeMetadata?: boolean;
    includeVectors?: boolean;
    namespace?: string;
    topK: number;
    vector: number[];
  }[];
  readonly upserts: { records: UpstashRecordLike[]; namespace?: string }[];
}

const fakeClient = (info: UpstashInfo = DEFAULT_INFO) => {
  const stored = new Map<string, Map<string, UpstashRecordLike>>();
  const recorded: Recorded = {
    deletedNamespaces: [],
    deletes: [],
    fetches: [],
    queries: [],
    resets: [],
    upserts: [],
  };
  const bucket = (namespace = ""): Map<string, UpstashRecordLike> => {
    const found = stored.get(namespace);
    if (found !== undefined) {
      return found;
    }
    const created = new Map<string, UpstashRecordLike>();
    stored.set(namespace, created);
    return created;
  };
  const client: UpstashIndexLike = {
    delete: (args, options: UpstashNamespaceOptions = {}) => {
      recorded.deletes.push({ args, namespace: options.namespace });
      if ("ids" in args) {
        for (const id of args.ids) {
          bucket(options.namespace).delete(id);
        }
      }
      return Promise.resolve({ deleted: 0 });
    },
    deleteNamespace: (namespace: string) => {
      recorded.deletedNamespaces.push(namespace);
      stored.delete(namespace);
      return Promise.resolve("Success");
    },
    fetch: (ids, options = {}) => {
      recorded.fetches.push({ ids, namespace: options.namespace });
      const records = bucket(options.namespace);
      return Promise.resolve(
        ids.map((id): UpstashStoredRecord | null => {
          const record = records.get(id);
          if (record === undefined) {
            return null;
          }
          const found: UpstashStoredRecord = {
            id: record.id,
            metadata: record.metadata,
          };
          return options.includeVectors === true
            ? { ...found, vector: record.vector }
            : found;
        })
      );
    },
    info: () => Promise.resolve(info),
    listNamespaces: () => Promise.resolve([...stored.keys()]),
    query: (args, options: UpstashNamespaceOptions = {}) => {
      recorded.queries.push({ ...args, namespace: options.namespace });
      return Promise.resolve(
        [...bucket(options.namespace).values()].map((record) => {
          const match: UpstashScoredRecord = {
            id: record.id,
            metadata: record.metadata,
            score: 0.9,
          };
          return args.includeVectors === true
            ? { ...match, vector: record.vector }
            : match;
        })
      );
    },
    reset: (options: UpstashNamespaceOptions = {}) => {
      recorded.resets.push(options.namespace);
      bucket(options.namespace).clear();
      return Promise.resolve("Success");
    },
    upsert: (records, options: UpstashNamespaceOptions = {}) => {
      recorded.upserts.push({ namespace: options.namespace, records });
      for (const record of records) {
        bucket(options.namespace).set(record.id, record);
      }
      return Promise.resolve("Success");
    },
  };
  return { client, recorded };
};

const errorKinds: [string, VecstoreError["kind"]][] = [
  ["Unauthorized: invalid token", "unauthorized"],
  ["Namespace not found", "not_found"],
  ["Index already exists", "already_exists"],
  ["Vector dimension 2 does not match index dimension 3", "invalid_argument"],
  ["Something went wrong on our side", "provider"],
];

describe(createUpstashStore, () => {
  test("the real Upstash client is accepted and returned as raw", () => {
    const client = new Index({
      token: "test-token",
      url: "https://example.upstash.io",
    });
    const raw: Index = createUpstashStore({ client }).raw;
    expect(raw).toBe(client);
  });

  test("an index is an Upstash namespace and the namespace is metadata", async () => {
    const { client, recorded } = fakeClient();
    const index = createUpstashStore({ client }).index("docs", {
      namespace: "tenant-a",
    });
    await index.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    expect(recorded.upserts).toStrictEqual([
      {
        namespace: "docs",
        records: [
          {
            id: "tenant-a/5/doc-1",
            metadata: {
              _id: "doc-1",
              _namespace: "tenant-a",
              genre: "drama",
            },
            vector: [1, 2, 3],
          },
        ],
      },
    ]);
  });

  test("query scopes the filter to the namespace and hides reserved keys", async () => {
    const { client, recorded } = fakeClient();
    const store = createUpstashStore({ client });
    const index = store.index("docs", { namespace: "tenant-a" });
    await index.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    const result = await index.query({
      filter: eq("genre", "drama"),
      topK: 2,
      vector: [1, 2, 3],
    });
    expect(recorded.queries).toStrictEqual([
      {
        filter: "(_namespace = 'tenant-a' AND genre = 'drama')",
        includeMetadata: true,
        includeVectors: false,
        namespace: "docs",
        topK: 2,
        vector: [1, 2, 3],
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [{ id: "doc-1", metadata: { genre: "drama" }, score: 0.9 }],
    });
  });

  test("the default namespace matches records that carry no namespace key", async () => {
    const { client, recorded } = fakeClient();
    await createUpstashStore({ client })
      .index("docs")
      .upsert([{ id: "doc-1", vector: [1, 2, 3] }]);
    await createUpstashStore({ client }).index("docs").delete({ all: true });
    expect(recorded.upserts[0]?.records[0]).toStrictEqual({
      id: "doc-1",
      metadata: {},
      vector: [1, 2, 3],
    });
    expect(recorded.deletes).toStrictEqual([
      {
        args: { filter: "(HAS NOT FIELD _namespace OR _namespace = '')" },
        namespace: "docs",
      },
    ]);
  });

  test("fetch and delete by id address the namespaced stored id", async () => {
    const { client, recorded } = fakeClient();
    const index = createUpstashStore({ client }).index("docs", {
      namespace: "tenant-a",
    });
    await index.upsert([
      { id: "b", vector: [2, 0, 0] },
      { id: "a", metadata: { n: 1 }, vector: [1, 0, 0] },
    ]);
    await expect(index.fetch(["a", "missing", "b"])).resolves.toStrictEqual({
      ok: true,
      value: [
        { id: "a", metadata: { n: 1 }, vector: [] },
        { id: "b", metadata: {}, vector: [] },
      ],
    });
    await index.delete({ ids: ["a"] });
    expect(recorded.fetches[0]?.ids).toStrictEqual([
      "tenant-a/1/a",
      "tenant-a/7/missing",
      "tenant-a/1/b",
    ]);
    expect(recorded.deletes).toStrictEqual([
      { args: { ids: ["tenant-a/1/a"] }, namespace: "docs" },
    ]);
  });

  test("fetch returns the vector only when asked", async () => {
    const { client } = fakeClient();
    const index = createUpstashStore({ client }).index("docs");
    await index.upsert([{ id: "a", vector: [1, 0, 0] }]);
    const withVectors = await index.fetch(["a"], { includeVector: true });
    expect(withVectors.ok && withVectors.value[0]?.vector).toStrictEqual([
      1, 0, 0,
    ]);
  });

  test("createIndex rejects a dimension the Upstash index cannot serve", async () => {
    const { client } = fakeClient();
    const result = await createUpstashStore({ client }).createIndex({
      dimension: 1536,
      name: "docs",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
  });

  test("createIndex rejects a metric the Upstash index cannot serve", async () => {
    const { client } = fakeClient();
    const result = await createUpstashStore({ client }).createIndex({
      dimension: 3,
      metric: "dot",
      name: "docs",
    });
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
  });

  test("createIndex accepts a matching spec and reports an existing namespace", async () => {
    const { client } = fakeClient();
    const store = createUpstashStore({ client });
    const created = await store.createIndex({
      dimension: 3,
      metric: "cosine",
      name: "docs",
    });
    expect(created.ok).toBe(true);
    await store.index("docs").upsert([{ id: "a", vector: [1, 0, 0] }]);
    const again = await store.createIndex({ dimension: 3, name: "docs" });
    expect(!again.ok && again.error.kind).toBe("already_exists");
  });

  test("listIndexes hides the default namespace and deleteIndex drops one", async () => {
    const { client, recorded } = fakeClient();
    const store = createUpstashStore({ client });
    await store.index("docs").upsert([{ id: "a", vector: [1, 0, 0] }]);
    await store.index("").upsert([{ id: "b", vector: [1, 0, 0] }]);
    await expect(store.listIndexes()).resolves.toStrictEqual({
      ok: true,
      value: ["docs"],
    });
    const deleted = await store.deleteIndex("docs");
    expect(deleted.ok).toBe(true);
    expect(recorded.deletedNamespaces).toStrictEqual(["docs"]);
    const missing = await store.deleteIndex("docs");
    expect(!missing.ok && missing.error.kind).toBe("not_found");
  });

  test("a filter Upstash cannot express is an invalid argument", async () => {
    const { client } = fakeClient();
    const result = await createUpstashStore({ client })
      .index("docs")
      .query({ filter: eq("my field", 1), topK: 1, vector: [1, 0, 0] });
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
  });

  test.each(errorKinds)("%s becomes %s", (message, kind) => {
    expect(normalizeUpstashError(upstashError(message), "docs").kind).toBe(
      kind
    );
  });

  test("a network failure is a connection error", () => {
    expect(
      normalizeUpstashError(new TypeError("fetch failed"), "docs").kind
    ).toBe("connection");
    expect(normalizeUpstashError("boom", "docs").kind).toBe("provider");
  });
});

describe(scopeUpstashFilter, () => {
  test("an undefined namespace scopes to the default namespace", () => {
    expect(scopeUpstashFilter()).toBe(
      "(HAS NOT FIELD _namespace OR _namespace = '')"
    );
    expect(scopeUpstashFilter("tenant-a", eq("genre", "drama"))).toBe(
      "(_namespace = 'tenant-a' AND genre = 'drama')"
    );
  });
});

const nativeStore = (client: UpstashIndexLike) =>
  createUpstashStore({ client, namespaceMode: "native" });

describe("upstash native namespaces", () => {
  test("each namespace becomes its own Upstash namespace", async () => {
    const { client, recorded } = fakeClient();
    const index = nativeStore(client).index("docs", { namespace: "tenant-a" });
    await index.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    expect(recorded.upserts).toStrictEqual([
      {
        namespace: "docs~tenant-a",
        records: [
          {
            id: "doc-1",
            metadata: { genre: "drama" },
            vector: [1, 2, 3],
          },
        ],
      },
    ]);
  });

  test("a query without a filter stays unfiltered", async () => {
    const { client, recorded } = fakeClient();
    const index = nativeStore(client).index("docs", { namespace: "tenant-a" });
    await index.query({ topK: 2, vector: [1, 2, 3] });
    await index.query({
      filter: eq("genre", "drama"),
      topK: 2,
      vector: [1, 2, 3],
    });
    expect(recorded.queries.map((query) => query.filter)).toStrictEqual([
      undefined,
      "genre = 'drama'",
    ]);
  });

  test("ids and metadata round-trip without reserved keys", async () => {
    const { client, recorded } = fakeClient();
    const index = nativeStore(client).index("docs", { namespace: "tenant-a" });
    await index.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    await expect(index.fetch(["doc-1"])).resolves.toStrictEqual({
      ok: true,
      value: [{ id: "doc-1", metadata: { genre: "drama" }, vector: [] }],
    });
    expect(recorded.fetches).toStrictEqual([
      { ids: ["doc-1"], namespace: "docs~tenant-a" },
    ]);
  });

  test("delete all resets the namespace instead of deleting by filter", async () => {
    const { client, recorded } = fakeClient();
    const index = nativeStore(client).index("docs", { namespace: "tenant-a" });
    await index.upsert([{ id: "doc-1", vector: [1, 2, 3] }]);
    await index.delete({ all: true });
    expect(recorded.resets).toStrictEqual(["docs~tenant-a"]);
    expect(recorded.deletes).toStrictEqual([]);
  });

  test("an index owns every namespace it opened", async () => {
    const { client, recorded } = fakeClient();
    const store = nativeStore(client);
    await store.index("docs").upsert([{ id: "a", vector: [1, 0, 0] }]);
    await store
      .index("docs", { namespace: "tenant-a" })
      .upsert([{ id: "a", vector: [1, 0, 0] }]);
    await store.index("logs").upsert([{ id: "a", vector: [1, 0, 0] }]);
    await expect(store.listIndexes()).resolves.toStrictEqual({
      ok: true,
      value: ["docs", "logs"],
    });
    const again = await store.createIndex({ dimension: 3, name: "docs" });
    expect(!again.ok && again.error.kind).toBe("already_exists");
    await store.deleteIndex("docs");
    expect(recorded.deletedNamespaces).toStrictEqual(["docs", "docs~tenant-a"]);
  });

  test("a name Upstash cannot put in a path is an invalid argument", async () => {
    const { client } = fakeClient();
    const separator = await nativeStore(client)
      .index("docs~v2")
      .upsert([{ id: "a", vector: [1, 0, 0] }]);
    expect(!separator.ok && separator.error.kind).toBe("invalid_argument");
    const escaped = await nativeStore(client)
      .index("docs", { namespace: "tenant a" })
      .upsert([{ id: "a", vector: [1, 0, 0] }]);
    expect(!escaped.ok && escaped.error.kind).toBe("invalid_argument");
  });

  test("metadata mode rejects an index name that needs URL escaping", async () => {
    const { client } = fakeClient();
    const result = await createUpstashStore({ client })
      .index("docs/v2")
      .upsert([{ id: "a", vector: [1, 0, 0] }]);
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
  });
});
