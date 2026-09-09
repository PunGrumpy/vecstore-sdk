import { describe, expect, test } from "bun:test";

import { Pinecone } from "@pinecone-database/pinecone";

import type { VecstoreError } from "../../src/errors";
import { eq } from "../../src/filter/ast";
import type {
  PineconeClientLike,
  PineconeFilter,
  PineconeIndexLike,
  PineconeRecordLike,
} from "../../src/pinecone";
import {
  createPineconeStore,
  normalizePineconeError,
} from "../../src/pinecone";

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
  readonly upserts: { records: PineconeRecordLike[]; namespace?: string }[];
}

const fakeClient = () => {
  const stored = new Map<string, PineconeRecordLike>();
  const recorded: Recorded = {
    createIndexes: [],
    deleteAlls: [],
    deleteManys: [],
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
      const found: Record<string, PineconeRecordLike> = {};
      for (const id of options.ids) {
        const record = stored.get(id);
        if (record !== undefined) {
          found[id] = record;
        }
      }
      return Promise.resolve({ records: found });
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

  test("the default namespace sends no namespace key", async () => {
    const { client, recorded } = fakeClient();
    await createPineconeStore({ client })
      .index("docs")
      .delete({ ids: ["a", "b"] });
    expect(recorded.deleteManys).toStrictEqual([{ ids: ["a", "b"] }]);
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
