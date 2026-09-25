import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { PGlite } from "@electric-sql/pglite";

import { errorMessage } from "../../src/errors";
import { isBoolean, isNumber, isString } from "../../src/internal/guards";
import { hasCode } from "../../src/internal/postgres";
import type { SupabaseCall, SupabaseClientLike } from "../../src/supabase";
import {
  createSupabaseStore,
  normalizeSupabaseError,
} from "../../src/supabase";
import { containsCases, liveCases, setupLive } from "../live/conformance";
import { createPostgres, installSupabaseSql } from "./pglite";

type ValueOf<T> = T extends object ? T[keyof T] : never;
type RpcArgValue = ValueOf<SupabaseCall["args"]>;

type RpcParam = string | number | boolean | null;

const JSONB_ARGS = new Set(["match_filter", "records"]);
const INT_ARGS = new Set(["dimension", "match_count"]);
const BOOLEAN_ARGS = new Set(["include_vector"]);
const TEXT_ARRAY_ARGS = new Set(["ids"]);

const placeholder = (key: string, position: number): string => {
  if (JSONB_ARGS.has(key)) {
    return `$${position}::jsonb`;
  }
  if (INT_ARGS.has(key)) {
    return `$${position}::int`;
  }
  if (BOOLEAN_ARGS.has(key)) {
    return `$${position}::boolean`;
  }
  if (TEXT_ARRAY_ARGS.has(key)) {
    return `(select array(select jsonb_array_elements_text(v)) from (select $${position}::jsonb as v) t where v is not null)`;
  }
  return `$${position}::text`;
};

const toParam = (key: string, value: RpcArgValue): RpcParam => {
  if (value === null || value === undefined) {
    return null;
  }
  if (JSONB_ARGS.has(key) || TEXT_ARRAY_ARGS.has(key)) {
    return JSON.stringify(value);
  }
  if (isString(value) || isNumber(value) || isBoolean(value)) {
    return value;
  }
  throw new Error(`unexpected rpc argument type for ${key}`);
};

export const rpcClient = (db: PGlite): SupabaseClientLike => ({
  rpc: async (fn, args) => {
    const entries = Object.entries(args);
    const named = entries
      .map(([key], index) => `${key} => ${placeholder(key, index + 1)}`)
      .join(", ");
    const params = entries.map(([key, value]) => toParam(key, value));
    try {
      const result = await db.query<object>(
        `select * from ${fn}(${named})`,
        params
      );
      return { data: result.rows, error: null };
    } catch (error) {
      const code = hasCode(error) ? error.code : undefined;
      return { data: null, error: { code, message: errorMessage(error) } };
    }
  },
});

describe("supabase on PGlite", () => {
  const db = createPostgres();
  beforeAll(() => installSupabaseSql(db));
  const live = setupLive(() => createSupabaseStore({ client: rpcClient(db) }));
  afterAll(() => db.close());

  test.each([...containsCases, ...liveCases])("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});

describe("vecstore_create_index index lifecycle on PGlite", () => {
  const db = createPostgres();
  beforeAll(() => installSupabaseSql(db));
  afterAll(() => db.close());

  test("rejects a name over 49 bytes with a 22023 error", async () => {
    const name = "a".repeat(50);
    const response = await rpcClient(db).rpc("vecstore_create_index", {
      dimension: 3,
      index_name: name,
      index_schema: null,
      metric: "cosine",
    });
    expect(response.error?.code).toBe("22023");
    const mapped = normalizeSupabaseError(
      Object.assign(new Error(response.error?.message ?? ""), {
        code: response.error?.code,
      }),
      { fn: "vecstore_create_index", index: name }
    );
    expect(mapped.kind).toBe("invalid_argument");
  });
});

describe("supabase install script", () => {
  const db = createPostgres();
  beforeAll(() => installSupabaseSql(db));
  afterAll(() => db.close());

  const asAnon = async <T>(fn: () => PromiseLike<T>): Promise<T> => {
    await db.exec("set role anon");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };

  const countSecured = async (): Promise<number> => {
    const result = await db.query<{ count: number }>(
      "select count(*) from secured"
    );
    return result.rows[0]?.count ?? -1;
  };

  test("enables row level security on a table createIndex makes", async () => {
    const store = createSupabaseStore({ client: rpcClient(db) });
    const created = await store.createIndex({ dimension: 3, name: "secured" });
    expect(created.ok).toBe(true);

    const rows = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'secured'"
    );
    expect(rows.rows[0]?.relrowsecurity).toBe(true);
  });

  test("anon reads nothing from a secured table until a policy exists", async () => {
    const store = createSupabaseStore({ client: rpcClient(db) });
    const upserted = await store
      .index("secured")
      .upsert([{ id: "a", vector: [0, 0, 1] }]);
    expect(upserted.ok).toBe(true);

    await db.exec("create role anon nologin; grant select on secured to anon");
    expect(await asAnon(countSecured)).toBe(0);

    await db.exec(
      "create policy secured_read on secured for select to anon using (true)"
    );
    expect(await asAnon(countSecured)).toBe(1);
  });

  test("anon cannot call the ddl functions once the supabase roles exist", async () => {
    await db.exec(
      "create role authenticated nologin; create role service_role nologin"
    );
    await installSupabaseSql(db);

    const response = await asAnon(() =>
      rpcClient(db).rpc("vecstore_create_index", {
        dimension: 3,
        index_name: "x",
        index_schema: null,
        metric: "cosine",
      })
    );
    expect(response.error?.code).toBe("42501");
  });

  test("a filter leaf that compiles to nothing fails closed", async () => {
    const malformedQueries = [
      `select vecstore_filter_sql('{"kind":"lt","field":"price"}'::jsonb, 'metadata')`,
      `select vecstore_filter_sql('{"kind":"and","filters":[{"kind":"eq","field":"t","value":"a"},{"kind":"lt","field":"p"}]}'::jsonb, 'metadata')`,
      `select vecstore_filter_sql('{"kind":"in","field":"g","values":[]}'::jsonb, 'metadata')`,
    ];
    await Promise.all(
      malformedQueries.map((query) =>
        expect(db.query(query)).rejects.toMatchObject({ code: "22023" })
      )
    );

    let deleteError: unknown;
    try {
      await db.query(
        "select vecstore_delete($1::text, null::text, $2::text, null::text[], $3::jsonb)",
        ["secured", "", JSON.stringify({ field: "price", kind: "lt" })]
      );
    } catch (error) {
      deleteError = error;
    }
    expect(hasCode(deleteError) && deleteError.code).toBe("22023");

    expect(await countSecured()).toBe(1);
  });
});
