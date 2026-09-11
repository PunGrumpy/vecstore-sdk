import { describe, expect, test } from "bun:test";

import { eq, gt } from "../../src/filter/ast";
import { isObjectLike } from "../../src/internal/guards";
import type {
  RedisClientLike,
  RedisCreateOptions,
  RedisJsonValue,
  RedisSchema,
  RedisSearchOptions,
  RedisSearchReply,
} from "../../src/redis";
import { createRedisStore, normalizeRedisError } from "../../src/redis";
import type { VectorRecord } from "../../src/types";

const INDEX = "docs";
const NAMESPACE = "tenant-a";
const DIMENSION = 3;

interface CreateCall {
  readonly index: string;
  readonly schema: RedisSchema;
  readonly options?: RedisCreateOptions;
}

interface SearchCall {
  readonly index: string;
  readonly query: string;
  readonly options?: RedisSearchOptions;
}

interface FakeClient {
  readonly client: RedisClientLike;
  readonly creates: CreateCall[];
  readonly searches: SearchCall[];
  readonly documents: Map<string, RedisJsonValue>;
  readonly unlinked: string[][];
}

const NAMESPACE_PATTERN = /@namespace:\{"(?<namespace>[^"]*)"\}/u;

const jsonEntry = (value: RedisJsonValue, key: string): RedisJsonValue => {
  if (!isObjectLike(value) || Array.isArray(value) || value instanceof Date) {
    return null;
  }
  return Object.entries(value).find(([name]) => name === key)?.[1] ?? null;
};

const namespaceOf = (query: string): string =>
  NAMESPACE_PATTERN.exec(query)?.groups?.namespace ?? "";

const documentValue = (
  stored: RedisJsonValue,
  options?: RedisSearchOptions
): object => {
  const fields: [string, string][] = [];
  for (const field of options?.RETURN ?? []) {
    if (field === "vector_distance") {
      fields.push([field, "0.25"]);
      continue;
    }
    const key = field.replace("$.", "");
    fields.push([field, JSON.stringify(jsonEntry(stored, key))]);
  }
  return Object.fromEntries(fields);
};

const createFakeClient = (): FakeClient => {
  const creates: CreateCall[] = [];
  const searches: SearchCall[] = [];
  const documents = new Map<string, RedisJsonValue>();
  const unlinked: string[][] = [];
  const indexes = new Set<string>();
  const client: RedisClientLike = {
    ft: {
      _list: () => Promise.resolve([...indexes]),
      create: (index, schema, options) => {
        if (indexes.has(index)) {
          return Promise.reject(new Error("Index already exists"));
        }
        indexes.add(index);
        creates.push({ index, options, schema });
        return Promise.resolve("OK");
      },
      dropIndex: (index, options) => {
        if (!indexes.delete(index)) {
          return Promise.reject(new Error("Unknown index name"));
        }
        if (options?.DD === true) {
          documents.clear();
        }
        return Promise.resolve("OK");
      },
      search: (index, query, options): Promise<RedisSearchReply> => {
        searches.push({ index, options, query });
        const namespace = namespaceOf(query);
        const matched = [...documents].filter(
          ([, stored]) => jsonEntry(stored, "namespace") === namespace
        );
        return Promise.resolve({
          documents: matched.map(([id, stored]) => ({
            id,
            value: documentValue(stored, options),
          })),
          total: matched.length,
        });
      },
    },
    json: {
      mGet: (keys) =>
        Promise.resolve(keys.map((key) => documents.get(key) ?? null)),
      set: (key, _path, json) => {
        documents.set(key, json);
        return Promise.resolve("OK");
      },
    },
    unlink: (keys) => {
      unlinked.push(keys);
      let removed = 0;
      for (const key of keys) {
        removed += documents.delete(key) ? 1 : 0;
      }
      return Promise.resolve(removed);
    },
  };
  return { client, creates, documents, searches, unlinked };
};

const records: VectorRecord[] = [
  { id: "doc-a", metadata: { genre: "drama", year: 1999 }, vector: [1, 0, 0] },
  { id: "doc-b", metadata: { genre: "comedy", year: 2010 }, vector: [0, 1, 0] },
];

const metadataFields = [
  { field: "genre", type: "tag" },
  { field: "year", type: "numeric" },
] as const;

const setup = async (namespace = NAMESPACE) => {
  const fake = createFakeClient();
  const store = createRedisStore({
    client: fake.client,
    metadataFields: [...metadataFields],
  });
  await store.createIndex({ dimension: DIMENSION, name: INDEX });
  const index = store.index(INDEX, { namespace });
  await index.upsert(records);
  return { fake, index, store };
};

const unwrap = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) {
    throw new Error("expected a value");
  }
  return result.value;
};

const errors: [string, unknown, string][] = [
  ["an existing index", new Error("Index already exists"), "already_exists"],
  ["a missing index", new Error("Unknown index name"), "not_found"],
  [
    "a rejected password",
    new Error("WRONGPASS invalid password"),
    "unauthorized",
  ],
  [
    "a missing module",
    new Error("ERR unknown command 'FT.CREATE'"),
    "unsupported",
  ],
  [
    "a refused socket",
    Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    "connection",
  ],
  ["a closed client", new Error("The client is closed"), "connection"],
  [
    "a malformed query",
    new Error("Syntax error at offset 4"),
    "invalid_argument",
  ],
  ["anything else", new Error("LOADING Redis is loading"), "provider"],
];

describe(createRedisStore, () => {
  test("createIndex declares the vector, the namespace, and the metadata", async () => {
    const { fake } = await setup();
    const [call] = fake.creates;
    expect(call?.options).toStrictEqual({
      ON: "JSON",
      PREFIX: "vecstore:docs:",
    });
    expect(call?.schema["$.vector"]).toMatchObject({
      ALGORITHM: "FLAT",
      DIM: DIMENSION,
      DISTANCE_METRIC: "COSINE",
    });
    expect(call?.schema["$.namespace"]).toMatchObject({
      CASESENSITIVE: true,
      INDEXEMPTY: true,
      type: "TAG",
    });
    expect(call?.schema["$.metadata.year"]).toMatchObject({
      INDEXMISSING: true,
      type: "NUMERIC",
    });
  });

  test("createIndex refuses a metadata field the adapter keeps", async () => {
    const fake = createFakeClient();
    const store = createRedisStore({
      client: fake.client,
      metadataFields: [{ field: "vector", type: "tag" }],
    });
    const result = await store.createIndex({
      dimension: DIMENSION,
      name: INDEX,
    });
    expect(result).toMatchObject({ error: { kind: "invalid_argument" } });
    expect(fake.creates).toHaveLength(0);
  });

  test("upsert writes one namespaced document per record", async () => {
    const { fake } = await setup();
    expect([...fake.documents.keys()]).toStrictEqual([
      "vecstore:docs:tenant-a:doc-a",
      "vecstore:docs:tenant-a:doc-b",
    ]);
    expect(fake.documents.get("vecstore:docs:tenant-a:doc-a")).toStrictEqual({
      metadata: { genre: "drama", year: 1999 },
      namespace: NAMESPACE,
      vector: [1, 0, 0],
    });
  });

  test("upsert refuses metadata the schema has no room for", async () => {
    const { fake, index } = await setup();
    const written = fake.documents.size;
    const result = await index.upsert([
      { id: "doc-c", metadata: { year: "1999" }, vector: [0, 0, 1] },
    ]);
    expect(result).toMatchObject({ error: { kind: "invalid_argument" } });
    expect(fake.documents.size).toBe(written);
  });

  test("query sends a KNN clause scoped to the namespace", async () => {
    const { fake, index } = await setup();
    await index.query({ filter: gt("year", 2000), topK: 5, vector: [1, 0, 0] });
    const [search] = fake.searches;
    expect(search?.query).toBe(
      '(@namespace:{"tenant-a"} @year:[(2000 +inf])=>[KNN 5 @vector $BLOB AS vector_distance]'
    );
    expect(search?.options?.LIMIT).toStrictEqual({ from: 0, size: 5 });
    expect(search?.options?.SORTBY).toStrictEqual({
      BY: "vector_distance",
      DIRECTION: "ASC",
    });
    expect(search?.options?.RETURN).toStrictEqual([
      "vector_distance",
      "$.metadata",
    ]);
  });

  test("query passes the vector as a float32 blob", async () => {
    const { fake, index } = await setup();
    await index.query({ topK: 1, vector: [1, 0.5, 0] });
    const blob = fake.searches[0]?.options?.PARAMS?.BLOB;
    const floats =
      blob instanceof Buffer
        ? new Float32Array(blob.buffer, blob.byteOffset, DIMENSION)
        : new Float32Array();
    expect([...floats]).toStrictEqual([1, 0.5, 0]);
  });

  test("query reads the id from the key and the distance as the score", async () => {
    const { index } = await setup();
    const matches = unwrap(await index.query({ topK: 2, vector: [1, 0, 0] }));
    expect(matches.map((match) => match.id)).toStrictEqual(["doc-a", "doc-b"]);
    expect(matches[0]?.score).toBe(0.25);
    expect(matches[0]?.metadata).toStrictEqual({ genre: "drama", year: 1999 });
    expect(matches[0]?.vector).toBeUndefined();
  });

  test("query returns the vector when asked", async () => {
    const { fake, index } = await setup();
    const matches = unwrap(
      await index.query({ includeVector: true, topK: 1, vector: [1, 0, 0] })
    );
    expect(fake.searches[0]?.options?.RETURN).toContain("$.vector");
    expect(matches[0]?.vector).toStrictEqual([1, 0, 0]);
  });

  test("query rejects a filter Redis cannot run before it sends one", async () => {
    const { fake, index } = await setup();
    const result = await index.query({
      filter: eq("director", "lynch"),
      topK: 1,
      vector: [1, 0, 0],
    });
    expect(result).toMatchObject({ error: { kind: "invalid_argument" } });
    expect(fake.searches).toHaveLength(0);
  });

  test("another namespace sees nothing", async () => {
    const { store } = await setup();
    const other = store.index(INDEX, { namespace: "tenant-b" });
    expect(
      unwrap(await other.query({ topK: 5, vector: [1, 0, 0] }))
    ).toStrictEqual([]);
  });

  test("fetch returns records in request order and skips misses", async () => {
    const { index } = await setup();
    const found = unwrap(await index.fetch(["doc-b", "missing", "doc-a"]));
    expect(found.map((record) => record.id)).toStrictEqual(["doc-b", "doc-a"]);
    expect(found[0]?.metadata).toStrictEqual({ genre: "comedy", year: 2010 });
    expect(found[0]?.vector).toStrictEqual([]);
  });

  test("fetch returns the vector when asked", async () => {
    const { index } = await setup();
    const found = unwrap(await index.fetch(["doc-a"], { includeVector: true }));
    expect(found[0]?.vector).toStrictEqual([1, 0, 0]);
  });

  test("delete by id unlinks the namespaced keys", async () => {
    const { fake, index } = await setup();
    await index.delete({ ids: ["doc-a"] });
    expect(fake.unlinked).toStrictEqual([["vecstore:docs:tenant-a:doc-a"]]);
    expect([...fake.documents.keys()]).toStrictEqual([
      "vecstore:docs:tenant-a:doc-b",
    ]);
  });

  test("delete all empties the namespace", async () => {
    const { fake, index } = await setup();
    await index.delete({ all: true });
    expect(fake.searches[0]?.query).toBe('@namespace:{"tenant-a"}');
    expect(fake.searches[0]?.options?.RETURN).toStrictEqual([]);
    expect(fake.documents.size).toBe(0);
  });

  test("delete by filter searches the namespace and the filter", async () => {
    const { fake, index } = await setup();
    await index.delete({ filter: eq("genre", "drama") });
    expect(fake.searches[0]?.query).toBe(
      '@namespace:{"tenant-a"} @genre:{"drama"}'
    );
  });

  test("the default namespace scopes on an empty tag", async () => {
    const { fake, index } = await setup("");
    await index.query({ topK: 1, vector: [1, 0, 0] });
    expect([...fake.documents.keys()]).toContain("vecstore:docs::doc-a");
    expect(fake.searches[0]?.query).toStartWith('(@namespace:{""}');
  });

  test("listIndexes names the indexes the server holds", async () => {
    const { store } = await setup();
    expect(unwrap(await store.listIndexes())).toStrictEqual([INDEX]);
  });

  test("deleteIndex drops the index and its documents", async () => {
    const { fake, store } = await setup();
    expect(await store.deleteIndex(INDEX)).toMatchObject({ ok: true });
    expect(fake.documents.size).toBe(0);
  });

  test("deleteIndex reports an index the server does not hold", async () => {
    const { store } = await setup();
    const result = await store.deleteIndex("other");
    expect(result).toMatchObject({ error: { kind: "not_found" } });
  });
});

describe(normalizeRedisError, () => {
  test.each(errors)("%s maps to a kind", (_name, cause, kind) => {
    expect(normalizeRedisError(cause, INDEX)).toMatchObject({ kind });
  });
});
