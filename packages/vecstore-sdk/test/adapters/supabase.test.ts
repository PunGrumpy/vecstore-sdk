import { describe, expect, test } from "bun:test";

import { createClient } from "@supabase/supabase-js";

import type { VecstoreError } from "../../src/errors";
import { and, eq, gt } from "../../src/filter/ast";
import type {
  SupabaseCall,
  SupabaseClientLike,
  SupabaseRpcError,
} from "../../src/supabase";
import {
  createSupabaseStore,
  normalizeSupabaseError,
} from "../../src/supabase";

const rpcError = (code: string): SupabaseRpcError => ({ code, message: code });

const postgrestError = (code: string) =>
  Object.assign(new Error(code), { code });

interface Call {
  readonly fn: string;
  readonly args: SupabaseCall["args"];
}

interface FakeOptions {
  readonly responses?: object[][];
  readonly error?: SupabaseRpcError;
}

const fakeClient = (options: FakeOptions = {}) => {
  const calls: Call[] = [];
  const pending = [...(options.responses ?? [])];
  const error = options.error ?? null;
  const client: SupabaseClientLike = {
    rpc: (fn, args) => {
      calls.push({ args, fn });
      return Promise.resolve({ data: pending.shift() ?? [], error });
    },
  };
  return { calls, client };
};

const codeKinds: [string, VecstoreError["kind"]][] = [
  ["42P01", "not_found"],
  ["42P07", "already_exists"],
  ["22023", "invalid_argument"],
  ["42501", "unauthorized"],
  ["PGRST301", "unauthorized"],
  ["PGRST202", "unsupported"],
  ["08006", "connection"],
  ["XX000", "provider"],
];

describe(createSupabaseStore, () => {
  test("a supabase-js client is accepted and returned as raw", () => {
    const client = createClient("https://example.supabase.co", "anon_key_here");
    const store = createSupabaseStore({ client });
    expect(store.raw).toBe(client);
    expect(store.provider).toBe("supabase");
  });

  test("createIndex passes the dimension and metric to the SQL function", async () => {
    const { client, calls } = fakeClient();
    const result = await createSupabaseStore({ client }).createIndex({
      dimension: 3,
      metric: "euclidean",
      name: "docs",
    });
    expect(result.ok).toBeTruthy();
    expect(calls).toStrictEqual([
      {
        args: {
          dimension: 3,
          index_name: "docs",
          index_schema: null,
          metric: "euclidean",
        },
        fn: "vecstore_create_index",
      },
    ]);
  });

  test("createIndex rejects a non-integer dimension before calling the database", async () => {
    const { client, calls } = fakeClient();
    const result = await createSupabaseStore({ client }).createIndex({
      dimension: 1.5,
      name: "docs",
    });
    expect(!result.ok && result.error.kind).toBe("invalid_argument");
    expect(calls).toHaveLength(0);
  });

  test("the schema option travels with every call", async () => {
    const { client, calls } = fakeClient({
      responses: [[], [{ name: "docs" }]],
    });
    const store = createSupabaseStore({ client, schema: "vec" });
    await store.deleteIndex("docs");
    await expect(store.listIndexes()).resolves.toStrictEqual({
      ok: true,
      value: ["docs"],
    });
    expect(calls).toStrictEqual([
      {
        args: { index_name: "docs", index_schema: "vec" },
        fn: "vecstore_drop_index",
      },
      { args: { index_schema: "vec" }, fn: "vecstore_list_indexes" },
    ]);
  });

  test("upsert sends vectors as pgvector literals", async () => {
    const { client, calls } = fakeClient();
    await createSupabaseStore({ client })
      .index("docs", { namespace: "tenant-a" })
      .upsert([
        { id: "a", metadata: { genre: "drama" }, vector: [1, 2] },
        { id: "b", vector: [3, 4] },
      ]);
    expect(calls).toStrictEqual([
      {
        args: {
          index_name: "docs",
          index_schema: null,
          match_namespace: "tenant-a",
          records: [
            { embedding: "[1,2]", id: "a", metadata: { genre: "drama" } },
            { embedding: "[3,4]", id: "b", metadata: {} },
          ],
        },
        fn: "vecstore_upsert",
      },
    ]);
  });

  test("query sends the filter as JSON and reads the returned rows", async () => {
    const { client, calls } = fakeClient({
      responses: [
        [
          {
            embedding: "[1,2]",
            id: "a",
            metadata: { genre: "drama", year: 2001 },
            score: 0.75,
          },
        ],
      ],
    });
    const filter = and(eq("genre", "drama"), gt("year", 2000));
    const result = await createSupabaseStore({ client })
      .index("docs")
      .query({ filter, includeVector: true, topK: 3, vector: [1, 2] });
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
    expect(calls[0]).toStrictEqual({
      args: {
        include_vector: true,
        index_name: "docs",
        index_schema: null,
        match_count: 3,
        match_filter: filter,
        match_namespace: "",
        query_embedding: "[1,2]",
      },
      fn: "vecstore_query",
    });
  });

  test("fetch returns records in request order", async () => {
    const { client, calls } = fakeClient({
      responses: [
        [
          { id: "b", metadata: {} },
          { id: "a", metadata: { n: 1 } },
        ],
      ],
    });
    const index = createSupabaseStore({ client }).index("docs");
    await expect(index.fetch(["a", "b"])).resolves.toStrictEqual({
      ok: true,
      value: [
        { id: "a", metadata: { n: 1 }, vector: [] },
        { id: "b", metadata: {}, vector: [] },
      ],
    });
    await expect(index.fetch([])).resolves.toStrictEqual({
      ok: true,
      value: [],
    });
    expect(calls).toStrictEqual([
      {
        args: {
          ids: ["a", "b"],
          include_vector: false,
          index_name: "docs",
          index_schema: null,
          match_namespace: "",
        },
        fn: "vecstore_fetch",
      },
    ]);
  });

  test("each delete selector maps to one set of arguments", async () => {
    const { client, calls } = fakeClient();
    const index = createSupabaseStore({ client }).index("docs");
    const filter = eq("genre", "drama");
    await index.delete({ ids: ["a"] });
    await index.delete({ filter });
    await index.delete({ all: true });
    expect(calls).toStrictEqual([
      {
        args: {
          ids: ["a"],
          index_name: "docs",
          index_schema: null,
          match_filter: null,
          match_namespace: "",
        },
        fn: "vecstore_delete",
      },
      {
        args: {
          ids: null,
          index_name: "docs",
          index_schema: null,
          match_filter: filter,
          match_namespace: "",
        },
        fn: "vecstore_delete",
      },
      {
        args: {
          ids: null,
          index_name: "docs",
          index_schema: null,
          match_filter: null,
          match_namespace: "",
        },
        fn: "vecstore_delete",
      },
    ]);
  });

  test("an RPC error becomes a result rather than a throw", async () => {
    const { client } = fakeClient({ error: rpcError("42P01") });
    const result = await createSupabaseStore({ client })
      .index("docs")
      .query({
        topK: 1,
        vector: [1],
      });
    expect(!result.ok && result.error.kind).toBe("not_found");
    expect(!result.ok && result.error.provider).toBe("supabase");
  });

  test("a missing SQL function names the function and the install file", async () => {
    const { client } = fakeClient({ error: rpcError("PGRST202") });
    const result = await createSupabaseStore({ client }).listIndexes();
    expect(!result.ok && result.error.kind).toBe("unsupported");
    expect(!result.ok && result.error.message).toContain("sql/supabase.sql");
  });

  test.each(codeKinds)("code %s becomes %s", (code, kind) => {
    const error = normalizeSupabaseError(postgrestError(code), {
      fn: "vecstore_query",
      index: "docs",
    });
    expect(error.kind).toBe(kind);
  });

  test("a failed fetch is a connection error", () => {
    const error = normalizeSupabaseError(new TypeError("Failed to fetch"), {
      fn: "vecstore_query",
      index: "docs",
    });
    expect(error.kind).toBe("connection");
  });

  test("an error without a code is a provider error", () => {
    const error = normalizeSupabaseError(new Error("plain"), {
      fn: "vecstore_query",
      index: "docs",
    });
    expect(error.kind).toBe("provider");
  });
});
