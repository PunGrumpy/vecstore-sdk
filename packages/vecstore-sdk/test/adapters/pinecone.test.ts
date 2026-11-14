import { describe, expect, test } from "bun:test";

import { Pinecone } from "@pinecone-database/pinecone";

import type { VecstoreError } from "../../src/errors";
import { eq } from "../../src/filter/ast";
import type { NonEmpty } from "../../src/filter/ast";
import type {
  PineconeClientLike,
  PineconeFilter,
  PineconeIndexLike,
  PineconeListPage,
  PineconeRecordLike,
} from "../../src/pinecone";
import {
  createPineconeStore,
  normalizePineconeError,
} from "../../src/pinecone";
import { emptySelector, filterWithoutValue } from "../malformed";

const UPSERT_BATCH = 100;

const namedError = (name: string, message = name) =>
  Object.assign(new Error(message), { name });

interface Recorded {
  readonly createIndexes: {
    dimension: number;
    metric: string;
    name: string;
    spec: object;
    waitUntilReady?: boolean;
  }[];
  readonly deleteAlls: { namespace?: string }[];
  readonly deleteManys: {
    ids?: string[];
    filter?: PineconeFilter;
    namespace?: string;
  }[];
  readonly queries: {
    filter?: PineconeFilter;
    includeMetadata?: boolean;
    includeValues?: boolean;
    namespace?: string;
    topK: number;
    vector: number[];
  }[];
  readonly fetches: string[][];
  readonly lists: {
    limit?: number;
    namespace?: string;
    paginationToken?: string;
  }[];
  readonly upserts: { records: PineconeRecordLike[]; namespace?: string }[];
}

const DEFAULT_LIST_LIMIT = 100;

const listPage = (
  ids: readonly string[],
  start: number,
  limit: number
): PineconeListPage => {
  const end = start + limit;
  const vectors = ids.slice(start, end).map((id) => ({ id }));

  return end < ids.length
    ? { pagination: { next: String(end) }, vectors }
    : { vectors };
};

const fakeClient = () => {
  const stored = new Map<string, PineconeRecordLike>();
  const namespaces = new Map<string, string>();

  const recorded: Recorded = {
    createIndexes: [],
    deleteAlls: [],
    deleteManys: [],
    fetches: [],
    lists: [],
    queries: [],
    upserts: [],
  };

  const index: PineconeIndexLike = {
    deleteAll: (options) => {
      recorded.deleteAlls.push(options ?? {});

      return Promise.resolve();
    },
    deleteMany: (options) => {
      recorded.deleteManys.push(options);

      return Promise.resolve();
    },
    fetch: (options) => {
      recorded.fetches.push(options.ids);

      const found: Record<string, PineconeRecordLike> = {};

      for (const id of options.ids) {
        const record = stored.get(id);

        if (record !== undefined) {
          found[id] = record;
        }
      }

      return Promise.resolve({ records: found });
    },
    listPaginated: (options) => {
      recorded.lists.push(options);

      const ids = [...namespaces.entries()]
        .flatMap(([id, namespace]) =>
          namespace === (options.namespace ?? "") ? [id] : []
        )
        .toSorted();

      return Promise.resolve(
        listPage(
          ids,
          Number(options.paginationToken ?? 0),
          options.limit ?? DEFAULT_LIST_LIMIT
        )
      );
    },
    query: (options) => {
      recorded.queries.push(options);

      return Promise.resolve({
        matches: [...stored.values()].map((record) => ({
          ...record,
          score: 0.9,
        })),
      });
    },
    upsert: (options) => {
      recorded.upserts.push(options);

      for (const record of options.records) {
        stored.set(record.id, record);
        namespaces.set(record.id, options.namespace ?? "");
      }

      return Promise.resolve();
    },
  };

  const client: PineconeClientLike = {
    createIndex: (options) => {
      recorded.createIndexes.push(options);

      return Promise.resolve();
    },
    deleteIndex: () => Promise.resolve(),
    index: () => index,
    listIndexes: () => Promise.resolve({ indexes: [{ name: "docs" }] }),
  };

  return { client, recorded };
};

const errorKinds: [string, VecstoreError["kind"]][] = [
  ["PineconeNotFoundError", "not_found"],
  ["PineconeConflictError", "already_exists"],
  ["PineconeAuthorizationError", "unauthorized"],
  ["PineconeConnectionError", "connection"],
  ["PineconeBadRequestError", "invalid_argument"],
  ["PineconeArgumentError", "invalid_argument"],
  ["PineconeInternalServerError", "provider"],
];

describe(createPineconeStore, () => {
  test("the real Pinecone client is accepted and returned as raw", () => {
    const client = new Pinecone({ apiKey: "test-key" });
    const raw: Pinecone = createPineconeStore({ client }).raw;
    expect(raw).toBe(client);
  });

  test("createIndex maps the metric and uses the default serverless spec", async () => {
    const { client, recorded } = fakeClient();
    await createPineconeStore({ client }).createIndex({
      dimension: 3,
      metric: "dot",
      name: "docs",
    });
    expect(recorded.createIndexes).toStrictEqual([
      {
        dimension: 3,
        metric: "dotproduct",
        name: "docs",
        spec: { serverless: { cloud: "aws", region: "us-east-1" } },
        waitUntilReady: true,
      },
    ]);
  });

  test("createIndex rejects a non-positive dimension before touching the client", async () => {
    const { client, recorded } = fakeClient();

    const result = await createPineconeStore({ client }).createIndex({
      dimension: 0,
      name: "docs",
    });

    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(recorded.createIndexes).toHaveLength(0);
  });

  test("namespaced verbs pass the namespace through", async () => {
    const { client, recorded } = fakeClient();

    const index = createPineconeStore({ client }).index("docs", {
      namespace: "tenant-a",
    });

    await index.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    await index.query({ filter: eq("genre", "drama"), topK: 2, vector: [1] });
    await index.delete({ all: true });
    expect(recorded.upserts).toStrictEqual([
      {
        namespace: "tenant-a",
        records: [
          { id: "doc-1", metadata: { genre: "drama" }, values: [1, 2, 3] },
        ],
      },
    ]);
    expect(recorded.queries).toStrictEqual([
      {
        filter: { genre: { $eq: "drama" } },
        includeMetadata: true,
        includeValues: false,
        namespace: "tenant-a",
        topK: 2,
        vector: [1],
      },
    ]);
    expect(recorded.deleteAlls).toStrictEqual([{ namespace: "tenant-a" }]);
  });

  test("upsert splits into batches of 100", async () => {
    const { client, recorded } = fakeClient();
    await createPineconeStore({ client })
      .index("docs", { namespace: "tenant-a" })
      .upsert(
        Array.from({ length: UPSERT_BATCH + 1 }, (_, i) => ({
          id: `r${i}`,
          vector: [i],
        }))
      );
    expect(
      recorded.upserts.map((upsert) => [
        upsert.namespace,
        upsert.records.length,
      ])
    ).toStrictEqual([
      ["tenant-a", UPSERT_BATCH],
      ["tenant-a", 1],
    ]);
  });

  test("upsert keeps the last record when a batch repeats an id", async () => {
    const { client, recorded } = fakeClient();
    await createPineconeStore({ client })
      .index("docs")
      .upsert([
        { id: "a", vector: [1] },
        { id: "a", vector: [2] },
      ]);
    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.upserts[0]?.records).toHaveLength(1);
    expect(recorded.upserts[0]?.records[0]?.id).toBe("a");
    expect(recorded.upserts[0]?.records[0]?.values).toStrictEqual([2]);
  });

  test("the default namespace sends no namespace key", async () => {
    const { client, recorded } = fakeClient();
    await createPineconeStore({ client })
      .index("docs")
      .delete({ ids: ["a", "b"] });
    expect(recorded.deleteManys).toStrictEqual([{ ids: ["a", "b"] }]);
  });

  test("delete by id splits into batches of 1000", async () => {
    const { client, recorded } = fakeClient();

    const ids: NonEmpty<string> = [
      "id-0",
      ...Array.from({ length: 1000 }, (_, i) => `id-${i + 1}`),
    ];

    await createPineconeStore({ client }).index("docs").delete({ ids });
    expect(recorded.deleteManys).toHaveLength(2);
    expect(recorded.deleteManys.map((call) => call.ids?.length)).toStrictEqual([
      1000, 1,
    ]);
  });

  test("fetch preserves request order and drops the vector unless asked", async () => {
    const index = createPineconeStore({ client: fakeClient().client }).index(
      "docs"
    );

    await index.upsert([
      { id: "b", vector: [2] },
      { id: "a", metadata: { n: 1 }, vector: [1] },
    ]);
    await expect(index.fetch(["a", "missing", "b"])).resolves.toStrictEqual({
      ok: true,
      value: [
        { id: "a", metadata: { n: 1 }, vector: [] },
        { id: "b", metadata: {}, vector: [] },
      ],
    });
    const withVectors = await index.fetch(["a"], { includeVector: true });
    expect(withVectors.ok && withVectors.value[0]?.vector).toStrictEqual([1]);
  });

  test("query leaves out metadata and the vector unless asked", async () => {
    const index = createPineconeStore({ client: fakeClient().client }).index(
      "docs"
    );

    await index.upsert([{ id: "a", metadata: { n: 1 }, vector: [1] }]);

    const bare = await index.query({
      includeMetadata: false,
      topK: 1,
      vector: [1],
    });

    expect(bare.ok && bare.value[0]?.id).toBe("a");
    expect(bare.ok && bare.value[0]?.metadata).toBeUndefined();
    expect(bare.ok && bare.value[0]?.vector).toBeUndefined();

    const full = await index.query({
      includeVector: true,
      topK: 1,
      vector: [1],
    });

    expect(full.ok && full.value[0]?.metadata).toStrictEqual({ n: 1 });
    expect(full.ok && full.value[0]?.vector).toStrictEqual([1]);
  });

  test("query rejects a non-positive topK before calling the provider", async () => {
    const { client, recorded } = fakeClient();

    const result = await createPineconeStore({ client })
      .index("docs")
      .query({ topK: 0, vector: [1] });

    expect(result.ok).toBeFalsy();
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(recorded.queries).toStrictEqual([]);
  });

  test("query and delete reject a malformed filter or selector before calling the provider", async () => {
    const { client, recorded } = fakeClient();
    const index = createPineconeStore({ client }).index("docs");

    const queried = await index.query({
      filter: filterWithoutValue,
      topK: 1,
      vector: [1, 0, 0],
    });

    const filtered = await index.delete({ filter: filterWithoutValue });
    const emptied = await index.delete(emptySelector);
    expect([queried, filtered, emptied]).toMatchObject([
      { error: { kind: "invalid_argument" } },
      { error: { kind: "invalid_argument" } },
      { error: { kind: "invalid_argument" } },
    ]);
    expect(recorded.queries).toStrictEqual([]);
    expect(recorded.deleteManys).toStrictEqual([]);
    expect(recorded.deleteAlls).toStrictEqual([]);
  });

  test("upsert rejects a record without vector values before calling the provider", async () => {
    const { client, recorded } = fakeClient();

    const result = await createPineconeStore({ client })
      .index("docs")
      .upsert([{ id: "doc-1", vector: [] }]);

    expect(result).toMatchObject({ error: { kind: "invalid_argument" } });
    expect(recorded.upserts).toStrictEqual([]);
  });

  test("delete by filter on an index that rejects it is unsupported", async () => {
    const { client } = fakeClient();

    const message =
      "Serverless indexes do not support deleting with metadata filtering";

    const rejecting: PineconeClientLike = {
      ...client,
      index: (options) => ({
        ...client.index(options),
        deleteMany: () =>
          Promise.reject(namedError("PineconeBadRequestError", message)),
      }),
    };

    const result = await createPineconeStore({ client: rejecting })
      .index("docs")
      .delete({ filter: eq("genre", "drama") });

    expect(result).toStrictEqual({
      error: {
        feature: "deleteByFilter",
        kind: "unsupported",
        message,
        provider: "pinecone",
      },
      ok: false,
    });
  });

  test("scan lists ids page by page and fetches them in list order", async () => {
    const { client, recorded } = fakeClient();
    const store = createPineconeStore({ client });
    const index = store.index("docs", { namespace: "tenant-a" });

    await store
      .index("docs", { namespace: "tenant-b" })
      .upsert([{ id: "other", vector: [9] }]);
    await index.upsert([
      { id: "c", vector: [3] },
      { id: "a", metadata: { n: 1 }, vector: [1] },
      { id: "b", vector: [2] },
    ]);

    const first = await index.scan({ limit: 2 });
    const cursor = first.ok ? first.value.cursor : undefined;
    const last = await index.scan({ cursor, includeVector: true, limit: 2 });

    expect(first).toStrictEqual({
      ok: true,
      value: {
        cursor: "2",
        records: [
          { id: "a", metadata: { n: 1 }, vector: [] },
          { id: "b", metadata: {}, vector: [] },
        ],
      },
    });
    expect(last.ok && last.value.records).toStrictEqual([
      { id: "c", metadata: {}, vector: [3] },
    ]);
    expect(last.ok && last.value.cursor).toBeUndefined();
    expect(
      recorded.lists.map((list) => [
        list.namespace,
        list.limit,
        list.paginationToken ?? null,
      ])
    ).toStrictEqual([
      ["tenant-a", 2, null],
      ["tenant-a", 2, "2"],
    ]);
  });

  test("scan lowers a limit above 100 to 100", async () => {
    const { client, recorded } = fakeClient();

    await createPineconeStore({ client }).index("docs").scan({ limit: 1000 });

    expect(recorded.lists.map((list) => list.limit)).toStrictEqual([100]);
  });

  test("scan of an empty page sends no fetch", async () => {
    const { client, recorded } = fakeClient();

    const result = await createPineconeStore({ client }).index("docs").scan();

    expect(result.ok && result.value.records).toStrictEqual([]);
    expect(recorded.fetches).toStrictEqual([]);
  });

  test.each([
    ["a zero limit", { limit: 0 }],
    ["an empty cursor", { cursor: "" }],
  ])("scan rejects %s before calling the provider", async (_name, options) => {
    const { client, recorded } = fakeClient();

    const result = await createPineconeStore({ client })
      .index("docs")
      .scan(options);

    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(recorded.lists).toStrictEqual([]);
  });

  test("scan on an index that cannot list ids is unsupported", async () => {
    const { client } = fakeClient();
    const message = "List is only supported on serverless indexes";

    const rejecting: PineconeClientLike = {
      ...client,
      index: (options) => ({
        ...client.index(options),
        listPaginated: () =>
          Promise.reject(namedError("PineconeBadRequestError", message)),
      }),
    };

    const result = await createPineconeStore({ client: rejecting })
      .index("docs")
      .scan();

    expect(result).toStrictEqual({
      error: {
        feature: "scan",
        kind: "unsupported",
        message,
        provider: "pinecone",
      },
      ok: false,
    });
  });

  test("scan with a stale cursor is an invalid argument, not an unsupported index", async () => {
    const { client } = fakeClient();
    const message = "Invalid pagination token";

    const rejecting: PineconeClientLike = {
      ...client,
      index: (options) => ({
        ...client.index(options),
        listPaginated: () =>
          Promise.reject(namedError("PineconeBadRequestError", message)),
      }),
    };

    const result = await createPineconeStore({ client: rejecting })
      .index("docs")
      .scan({ cursor: "stale" });

    expect(!result.ok && result.error.kind).toBe("invalid_argument");
  });

  test.each(errorKinds)("%s becomes %s", (name, kind) => {
    expect(
      normalizePineconeError(namedError(name), { index: "docs" }).kind
    ).toBe(kind);
  });

  test("a non-Error rejection is a provider error", () => {
    expect(normalizePineconeError("boom", { index: "docs" }).kind).toBe(
      "provider"
    );
  });
});
