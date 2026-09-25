import { describe, expect, test } from "bun:test";

import Cloudflare from "cloudflare";

import type { VecstoreError } from "../../src/errors";
import { eq, or } from "../../src/filter/ast";
import type { MetadataValue } from "../../src/types";
import type { VectorizeFilter } from "../../src/vectorize";
import {
  createVectorizeStore,
  normalizeVectorizeError,
  toVectorizeId,
} from "../../src/vectorize";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const MAX_ID_BYTES = 64;
const UPSERT_BATCH = 1000;
const ACCOUNT_ID = "account-1";

interface StoredVector {
  readonly id: string;
  readonly values: number[];
  readonly namespace?: string;
  readonly metadata: Record<string, MetadataValue>;
}

interface CreateBody {
  readonly name: string;
  readonly config: { readonly dimensions: number; readonly metric: string };
}

interface MetadataIndexBody {
  readonly propertyName: string;
  readonly indexType: string;
}

interface QueryBody {
  readonly vector: number[];
  readonly topK: number;
  readonly returnValues: boolean;
  readonly returnMetadata: string;
  readonly namespace?: string;
  readonly filter?: VectorizeFilter;
}

interface IdsBody {
  readonly ids: string[];
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: string;
}

const parse = <Body>(body: string): Body => JSON.parse(body);

const statusError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

const bodyOf = async (init: RequestInit): Promise<string> => {
  const { body } = init;
  if (body === undefined || body === null) {
    return "";
  }
  return await new Response(body).text();
};

type Store = Map<string, StoredVector>;

const envelope = <Payload>(result: Payload): Response =>
  Response.json({ errors: [], messages: [], result, success: true });

const upsertAction = (body: string, stored: Store): Response => {
  for (const line of body.split("\n")) {
    const vector = parse<StoredVector>(line);
    stored.set(vector.id, vector);
  }
  return envelope({ mutationId: "mutation" });
};

const getByIdsAction = (body: string, stored: Store): Response => {
  const found: StoredVector[] = [];
  for (const id of parse<IdsBody>(body).ids) {
    const vector = stored.get(id);
    if (vector !== undefined) {
      found.push(vector);
    }
  }
  return envelope(found);
};

const deleteByIdsAction = (body: string, stored: Store): Response => {
  for (const id of parse<IdsBody>(body).ids) {
    stored.delete(id);
  }
  return envelope({ mutationId: "mutation" });
};

const queryAction = (body: string, stored: Store): Response => {
  const request = parse<QueryBody>(body);
  const matches = [];
  for (const vector of stored.values()) {
    if ((vector.namespace ?? "") === (request.namespace ?? "")) {
      matches.push({
        id: vector.id,
        metadata: request.returnMetadata === "none" ? null : vector.metadata,
        namespace: vector.namespace ?? null,
        score: 0.9,
        values: request.returnValues ? vector.values : null,
      });
    }
  }
  return envelope({ count: matches.length, matches });
};

const runAction = (action: string, body: string, stored: Store): Response => {
  switch (action) {
    case "upsert": {
      return upsertAction(body, stored);
    }
    case "get_by_ids": {
      return getByIdsAction(body, stored);
    }
    case "delete_by_ids": {
      return deleteByIdsAction(body, stored);
    }
    case "query": {
      return queryAction(body, stored);
    }
    default: {
      return envelope({ mutationId: "mutation" });
    }
  }
};

const fakeCloudflare = (failing: ReadonlySet<string> = new Set()) => {
  const stored: Store = new Map();
  const calls: Call[] = [];

  const handle = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? "GET";
    const { pathname, search } = new URL(url);
    const body = await bodyOf(init);
    const tail = pathname.split("/vectorize/v2/indexes")[1] ?? "";
    const segments = tail.split("/").filter((part) => part !== "");
    calls.push({ body, method, path: tail, search });
    const [indexName, action] = segments;
    if (indexName === undefined) {
      return method === "GET"
        ? envelope([{ name: "docs" }, { name: "logs" }])
        : envelope({ name: parse<CreateBody>(body).name });
    }
    if (action === undefined) {
      return envelope(null);
    }
    if (failing.has(action)) {
      return Response.json(
        {
          errors: [{ code: 1000, message: "metadata index limit reached" }],
          messages: [],
          result: null,
          success: false,
        },
        { status: 400 }
      );
    }
    return runAction(action, body, stored);
  };

  const client = new Cloudflare({
    apiToken: "test-token",
    fetch: (input, init) => handle(String(input), init ?? {}),
  });
  return { calls, client, stored };
};

const bodiesFor = (calls: readonly Call[], suffix: string): string[] => {
  const bodies: string[] = [];
  for (const call of calls) {
    if (call.path.endsWith(suffix)) {
      bodies.push(call.body);
    }
  }
  return bodies;
};

const errorKinds: [number, string, VecstoreError["kind"]][] = [
  [404, "index not found", "not_found"],
  [409, "index already exists", "already_exists"],
  [401, "invalid token", "unauthorized"],
  [403, "forbidden", "unauthorized"],
  [400, "vectorize index already exists", "already_exists"],
  [400, "index docs does not exist", "not_found"],
  [400, "dimension mismatch", "invalid_argument"],
  [422, "malformed vector", "invalid_argument"],
  [429, "rate limited", "provider"],
  [500, "internal error", "provider"],
];

describe(toVectorizeId, () => {
  test("a namespaced id becomes a stable uuid", () => {
    const id = toVectorizeId("tenant-a", "doc-1");
    expect(id).toMatch(UUID_PATTERN);
    expect(toVectorizeId("tenant-a", "doc-1")).toBe(id);
    expect(toVectorizeId("tenant-b", "doc-1")).not.toBe(id);
    expect(toVectorizeId("", "doc-1")).toBe("doc-1");
  });

  test("an id past the 64 byte limit is hashed", () => {
    const longest = "d".repeat(MAX_ID_BYTES);
    expect(toVectorizeId("", longest)).toBe(longest);
    expect(toVectorizeId("", `${longest}d`)).toMatch(UUID_PATTERN);
    expect(toVectorizeId("", "é".repeat(MAX_ID_BYTES))).toMatch(UUID_PATTERN);
  });
});

describe(createVectorizeStore, () => {
  test("the Cloudflare client comes back as raw", () => {
    const { client } = fakeCloudflare();
    const raw: Cloudflare = createVectorizeStore({
      accountId: ACCOUNT_ID,
      client,
    }).raw;
    expect(raw).toBe(client);
  });

  test("createIndex maps the metric and opens the metadata indexes", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({
      accountId: ACCOUNT_ID,
      client,
      metadataIndexes: [{ property: "genre", type: "string" }],
    }).createIndex({ dimension: 3, metric: "dot", name: "docs" });
    const [created] = bodiesFor(calls, "");
    expect(parse<CreateBody>(created ?? "{}")).toStrictEqual({
      config: { dimensions: 3, metric: "dot-product" },
      name: "docs",
    });
    const [metadataIndex] = bodiesFor(calls, "/metadata_index/create");
    expect(parse<MetadataIndexBody>(metadataIndex ?? "{}")).toStrictEqual({
      indexType: "string",
      propertyName: "genre",
    });
  });

  test("createIndex rejects a non-positive dimension before touching the client", async () => {
    const { calls, client } = fakeCloudflare();
    const result = await createVectorizeStore({
      accountId: ACCOUNT_ID,
      client,
    }).createIndex({ dimension: 0, name: "docs" });
    expect(result).toMatchObject({
      error: { kind: "invalid_argument", provider: "vectorize" },
      ok: false,
    });
    expect(calls).toHaveLength(0);
  });

  test("createIndex deletes the index when a metadata index cannot be created", async () => {
    const { calls, client } = fakeCloudflare(new Set(["metadata_index"]));
    const result = await createVectorizeStore({
      accountId: ACCOUNT_ID,
      client,
      metadataIndexes: [{ property: "genre", type: "string" }],
    }).createIndex({ dimension: 3, name: "docs" });
    expect(result).toMatchObject({
      error: { kind: "invalid_argument", provider: "vectorize" },
      ok: false,
    });
    const metadataIndexCall = calls.findIndex((call) =>
      call.path.endsWith("/metadata_index/create")
    );
    const deleteCall = calls.findIndex(
      (call) => call.method === "DELETE" && call.path === "/docs"
    );
    expect(metadataIndexCall).toBeGreaterThanOrEqual(0);
    expect(deleteCall).toBeGreaterThan(metadataIndexCall);
  });

  test("a namespaced upsert hashes the id and keeps the original in _id", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs", { namespace: "tenant-a" })
      .upsert([
        { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
      ]);
    const [ndjson] = bodiesFor(calls, "/upsert");
    expect(parse<StoredVector>(ndjson ?? "{}")).toStrictEqual({
      id: toVectorizeId("tenant-a", "doc-1"),
      metadata: { _id: "doc-1", genre: "drama" },
      namespace: "tenant-a",
      values: [1, 2, 3],
    });
  });

  test("the default namespace keeps the id and sends no namespace", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .upsert([{ id: "doc-1", vector: [1] }]);
    const [ndjson] = bodiesFor(calls, "/upsert");
    expect(parse<StoredVector>(ndjson ?? "{}")).toStrictEqual({
      id: "doc-1",
      metadata: {},
      values: [1],
    });
  });

  test("upsert keeps the last record when a batch repeats an id", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .upsert([
        { id: "a", vector: [1] },
        { id: "a", vector: [2] },
      ]);
    const bodies = bodiesFor(calls, "/upsert");
    expect(bodies).toHaveLength(1);
    const lines = (bodies[0] ?? "").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(parse<StoredVector>(lines[0] ?? "{}").values).toStrictEqual([2]);
  });

  test("upsert makes Vectorize fail on a line it cannot read", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .upsert([{ id: "doc-1", vector: [1] }]);
    const upsert = calls.find((call) => call.path.endsWith("/upsert"));
    const params = new URLSearchParams(upsert?.search);
    expect(params.get("unparsable-behavior")).toBe("error");
  });

  test("upsert splits into 1000-line NDJSON bodies", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .upsert(
        Array.from({ length: UPSERT_BATCH + 1 }, (_, i) => ({
          id: `r${i}`,
          vector: [i],
        }))
      );
    const bodies = bodiesFor(calls, "/upsert");
    expect(bodies.map((body) => body.split("\n").length)).toStrictEqual([
      UPSERT_BATCH,
      1,
    ]);
  });

  test("fetch currently keeps a stored vector that reports no namespace and drops one from another namespace", async () => {
    const { client, stored } = fakeCloudflare();
    const bare = toVectorizeId("tenant-a", "doc-x");
    const foreign = toVectorizeId("tenant-a", "doc-y");
    stored.set(bare, { id: bare, metadata: { _id: "doc-x" }, values: [1] });
    stored.set(foreign, {
      id: foreign,
      metadata: { _id: "doc-y" },
      namespace: "tenant-b",
      values: [2],
    });
    await expect(
      createVectorizeStore({ accountId: ACCOUNT_ID, client })
        .index("docs", { namespace: "tenant-a" })
        .fetch(["doc-x", "doc-y"])
    ).resolves.toStrictEqual({
      ok: true,
      value: [{ id: "doc-x", metadata: {}, vector: [] }],
    });
  });

  test("query scopes by namespace and returns the original id", async () => {
    const { calls, client } = fakeCloudflare();
    const docs = createVectorizeStore({ accountId: ACCOUNT_ID, client }).index(
      "docs",
      { namespace: "tenant-a" }
    );
    await docs.upsert([
      { id: "doc-1", metadata: { genre: "drama" }, vector: [1, 2, 3] },
    ]);
    const result = await docs.query({
      filter: eq("genre", "drama"),
      topK: 5,
      vector: [1, 2, 3],
    });
    const [sent] = bodiesFor(calls, "/query");
    expect(parse<QueryBody>(sent ?? "{}")).toStrictEqual({
      filter: { genre: { $eq: "drama" } },
      namespace: "tenant-a",
      returnMetadata: "all",
      returnValues: false,
      topK: 5,
      vector: [1, 2, 3],
    });
    expect(result).toMatchObject({
      ok: true,
      value: [{ id: "doc-1", metadata: { genre: "drama" }, score: 0.9 }],
    });
  });

  test("query rejects a non-positive topK before calling the provider", async () => {
    const { calls, client } = fakeCloudflare();
    const result = await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .query({ topK: 0, vector: [1] });
    expect(result.ok).toBeFalsy();
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(bodiesFor(calls, "/query")).toStrictEqual([]);
  });

  test("a filter Vectorize cannot express is reported before the request", async () => {
    const { calls, client } = fakeCloudflare();
    const result = await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .query({ filter: or(eq("a", 1), eq("b", 2)), topK: 5, vector: [1] });
    expect(result).toMatchObject({
      error: {
        feature: "orFilter",
        kind: "unsupported",
        provider: "vectorize",
      },
      ok: false,
    });
    expect(bodiesFor(calls, "/query")).toStrictEqual([]);
  });

  test("fetch preserves request order and drops the vector unless asked", async () => {
    const { client } = fakeCloudflare();
    const docs = createVectorizeStore({ accountId: ACCOUNT_ID, client }).index(
      "docs",
      { namespace: "tenant-a" }
    );
    await docs.upsert([
      { id: "doc-b", vector: [2] },
      { id: "doc-a", metadata: { n: 1 }, vector: [1] },
    ]);
    await expect(
      docs.fetch(["doc-a", "missing", "doc-b"])
    ).resolves.toStrictEqual({
      ok: true,
      value: [
        { id: "doc-a", metadata: { n: 1 }, vector: [] },
        { id: "doc-b", metadata: {}, vector: [] },
      ],
    });
    const withVectors = await docs.fetch(["doc-a"], { includeVector: true });
    expect(withVectors.ok && withVectors.value[0]?.vector).toStrictEqual([1]);
  });

  test("delete by id sends the stored ids", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs", { namespace: "tenant-a" })
      .delete({ ids: ["doc-1", "doc-2"] });
    const [sent] = bodiesFor(calls, "/delete_by_ids");
    expect(parse<IdsBody>(sent ?? "{}").ids).toStrictEqual([
      toVectorizeId("tenant-a", "doc-1"),
      toVectorizeId("tenant-a", "doc-2"),
    ]);
    expect(bodiesFor(calls, "/get_by_ids")).toStrictEqual([]);
  });

  test("a default namespace delete leaves another namespace's vector alone", async () => {
    const { calls, client, stored } = fakeCloudflare();
    const foreign = toVectorizeId("tenant-b", "doc-1");
    stored.set(foreign, {
      id: foreign,
      metadata: { _id: "doc-1" },
      namespace: "tenant-b",
      values: [1],
    });
    await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .delete({ ids: [foreign] });
    expect(bodiesFor(calls, "/delete_by_ids")).toStrictEqual([]);
    expect(stored.size).toBe(1);
  });

  test("delete by filter and delete all are unsupported", async () => {
    const { client } = fakeCloudflare();
    const docs = createVectorizeStore({ accountId: ACCOUNT_ID, client }).index(
      "docs"
    );
    await expect(docs.delete({ filter: eq("a", 1) })).resolves.toMatchObject({
      error: { feature: "deleteByFilter", kind: "unsupported" },
      ok: false,
    });
    await expect(docs.delete({ all: true })).resolves.toMatchObject({
      error: { feature: "deleteAll", kind: "unsupported" },
      ok: false,
    });
  });

  test("a namespace containing a slash is rejected before the request", async () => {
    const { calls, client } = fakeCloudflare();
    const result = await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs", { namespace: "a/3" })
      .upsert([{ id: "b", vector: [1] }]);
    expect(result).toMatchObject({
      error: { kind: "invalid_argument", provider: "vectorize" },
      ok: false,
    });
    expect(bodiesFor(calls, "/upsert")).toStrictEqual([]);
  });

  test("upsert rejects a record that sets a reserved metadata key", async () => {
    const { calls, client } = fakeCloudflare();
    const result = await createVectorizeStore({ accountId: ACCOUNT_ID, client })
      .index("docs")
      .upsert([{ id: "x", metadata: { _id: "other" }, vector: [1] }]);
    expect(result).toMatchObject({
      error: { kind: "invalid_argument", provider: "vectorize" },
      ok: false,
    });
    expect(bodiesFor(calls, "/upsert")).toStrictEqual([]);
  });

  test("listIndexes reads the names off the page", async () => {
    const { client } = fakeCloudflare();
    await expect(
      createVectorizeStore({ accountId: ACCOUNT_ID, client }).listIndexes()
    ).resolves.toStrictEqual({ ok: true, value: ["docs", "logs"] });
  });

  test("deleteIndex names the index it drops", async () => {
    const { calls, client } = fakeCloudflare();
    await createVectorizeStore({
      accountId: ACCOUNT_ID,
      client,
    }).deleteIndex("docs");
    expect(calls).toStrictEqual([
      { body: "", method: "DELETE", path: "/docs", search: "" },
    ]);
  });

  test.each(errorKinds)("%s %s becomes %s", (status, message, kind) => {
    const error = normalizeVectorizeError(statusError(status, message), "docs");
    expect(error.kind).toBe(kind);
  });

  test("a failure with no status is a connection or provider error", () => {
    const dropped = normalizeVectorizeError(new Error("Connection error."), "");
    expect(dropped.kind).toBe("connection");
    expect(normalizeVectorizeError("boom", "").kind).toBe("provider");
  });
});
