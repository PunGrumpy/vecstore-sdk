import { describe, expect, test } from "bun:test";

import type { PGlite } from "@electric-sql/pglite";

import { errorMessage } from "../../src/errors";
import { eq } from "../../src/filter/ast";
import { isBoolean, isNumber, isString } from "../../src/internal/guards";
import { hasCode } from "../../src/internal/postgres";
import type { SupabaseCall, SupabaseClientLike } from "../../src/supabase";
import {
  createSupabaseStore,
  normalizeSupabaseError,
} from "../../src/supabase";
import {
  containsCases,
  liveCases,
  negatedRangeCases,
  setupLive,
} from "../live/conformance";
import {
  AVOID_INDEX_SCAN,
  ensureRoles,
  FORCE_INDEX_SCAN,
  installSupabaseSql,
  isDescending,
  NEAREST_FIRST_ZERO_LAST,
  spreadRecords,
  usePostgres,
  zeroVectorRecords,
} from "./pglite";

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
  const db = usePostgres(installSupabaseSql);
  const live = setupLive(
    () => createSupabaseStore({ client: rpcClient(db()) }),
    { isolated: true }
  );

  test.each([...containsCases, ...liveCases, ...negatedRangeCases])(
    "%s",
    async (_name, run) => {
      await expect(run(live())).resolves.toBeUndefined();
    }
  );
});

describe("vecstore_create_index index lifecycle on PGlite", () => {
  const db = usePostgres(installSupabaseSql);

  test("rejects a name over 49 bytes with a 22023 error", async () => {
    const name = "a".repeat(50);
    const response = await rpcClient(db()).rpc("vecstore_create_index", {
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

describe("vecstore_metric on PGlite", () => {
  const db = usePostgres(installSupabaseSql);

  test("a euclidean index named after an opclass keeps its metric", async () => {
    const store = createSupabaseStore({ client: rpcClient(db()) });
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
});

describe("a cosine vecstore_query that meets a zero vector on PGlite", () => {
  const db = usePostgres(async (client) => {
    await installSupabaseSql(client);
    const store = createSupabaseStore({ client: rpcClient(client) });
    await store.createIndex({ dimension: 2, name: "zeroed" });
    await store.index("zeroed").upsert(zeroVectorRecords);
    await client.exec(AVOID_INDEX_SCAN);
  });

  test("ranks the zero vector last", async () => {
    const result = await createSupabaseStore({ client: rpcClient(db()) })
      .index("zeroed")
      .query({ topK: 4, vector: [1, 0] });
    expect(result.ok && result.value.map((match) => match.id)).toStrictEqual(
      NEAREST_FIRST_ZERO_LAST
    );
  });
});

describe("supabase install script", () => {
  const db = usePostgres(installSupabaseSql);

  const asRole = async <T>(
    role: string,
    fn: () => PromiseLike<T>
  ): Promise<T> => {
    await db().exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db().exec("reset role");
    }
  };

  const createSecured = async (name: string): Promise<void> => {
    const store = createSupabaseStore({ client: rpcClient(db()) });
    const created = await store.createIndex({ dimension: 3, name });
    expect(created.ok).toBe(true);
  };

  const countRows = async (table: string): Promise<number> => {
    const result = await db().query<{ count: number }>(
      `select count(*) from ${table}`
    );
    return result.rows[0]?.count ?? -1;
  };

  test("enables row level security on a table createIndex makes", async () => {
    await createSecured("secured_rls");

    const rows = await db().query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname = 'secured_rls'"
    );
    expect(rows.rows[0]?.relrowsecurity).toBe(true);
  });

  test("anon reads nothing from a secured table until a policy exists", async () => {
    await createSecured("secured_anon");
    const store = createSupabaseStore({ client: rpcClient(db()) });
    const upserted = await store
      .index("secured_anon")
      .upsert([{ id: "a", vector: [0, 0, 1] }]);
    expect(upserted.ok).toBe(true);

    await ensureRoles(db(), ["anon"]);
    await db().exec("grant select on secured_anon to anon");
    expect(await asRole("anon", () => countRows("secured_anon"))).toBe(0);

    await db().exec(
      "create policy secured_read on secured_anon for select to anon using (true)"
    );
    expect(await asRole("anon", () => countRows("secured_anon"))).toBe(1);
  });

  test("every vecstore function runs with the privileges of its caller", async () => {
    const functions = await db().query<{ definer: boolean; name: string }>(
      "select proname as name, prosecdef as definer from pg_proc where proname like 'vecstore\\_%'"
    );
    expect(functions.rows.length).toBeGreaterThan(0);
    expect(functions.rows.filter((row) => row.definer)).toStrictEqual([]);
  });

  test.each(["anon", "authenticated"])(
    "%s reads and changes nothing through the adapter until a policy exists",
    async (role) => {
      const name = `secured_${role}_verbs`;
      await createSecured(name);
      const index = createSupabaseStore({ client: rpcClient(db()) }).index(
        name
      );
      await index.upsert([{ id: "a", vector: [0, 0, 1] }]);

      await ensureRoles(db(), [role]);
      await db().exec(
        `grant select, insert, update, delete on ${name} to ${role}`
      );

      const queried = await asRole(role, () =>
        index.query({ topK: 1, vector: [0, 0, 1] })
      );
      const fetched = await asRole(role, () => index.fetch(["a"]));
      const upserted = await asRole(role, () =>
        index.upsert([{ id: "b", vector: [1, 0, 0] }])
      );
      const deleted = await asRole(role, () => index.delete({ ids: ["a"] }));

      expect(queried.ok && queried.value).toStrictEqual([]);
      expect(fetched.ok && fetched.value).toStrictEqual([]);
      expect(upserted.ok || upserted.error.kind).toBe("unauthorized");
      expect(deleted.ok).toBe(true);
      const remaining = await db().query<{ id: string }>(
        `select id from ${name}`
      );
      expect(remaining.rows.map((row) => row.id)).toStrictEqual(["a"]);
    }
  );

  test("anon cannot call the ddl functions once the supabase roles exist", async () => {
    await ensureRoles(db(), ["anon", "authenticated", "service_role"]);
    await installSupabaseSql(db());

    const response = await asRole("anon", () =>
      rpcClient(db()).rpc("vecstore_create_index", {
        dimension: 3,
        index_name: "x",
        index_schema: null,
        metric: "cosine",
      })
    );
    expect(response.error?.code).toBe("42501");
  });

  test("a filter leaf that compiles to nothing fails closed", async () => {
    await createSecured("secured_closed");
    const store = createSupabaseStore({ client: rpcClient(db()) });
    await store
      .index("secured_closed")
      .upsert([{ id: "a", vector: [0, 0, 1] }]);

    const malformedQueries = [
      `select vecstore_filter_sql('{"kind":"lt","field":"price"}'::jsonb, 'metadata')`,
      `select vecstore_filter_sql('{"kind":"and","filters":[{"kind":"eq","field":"t","value":"a"},{"kind":"lt","field":"p"}]}'::jsonb, 'metadata')`,
      `select vecstore_filter_sql('{"kind":"in","field":"g","values":[]}'::jsonb, 'metadata')`,
    ];
    await Promise.all(
      malformedQueries.map((query) =>
        expect(db().query(query)).rejects.toMatchObject({ code: "22023" })
      )
    );

    let deleteError: unknown;
    try {
      await db().query(
        "select vecstore_delete($1::text, null::text, $2::text, null::text[], $3::jsonb)",
        ["secured_closed", "", JSON.stringify({ field: "price", kind: "lt" })]
      );
    } catch (error) {
      deleteError = error;
    }
    expect(hasCode(deleteError) && deleteError.code).toBe("22023");

    expect(await countRows("secured_closed")).toBe(1);
  });
});

describe("vecstore_query through the HNSW index on PGlite", () => {
  const db = usePostgres(async (client) => {
    await installSupabaseSql(client);
    const store = createSupabaseStore({ client: rpcClient(client) });
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
    createSupabaseStore({ client: rpcClient(db()) }).index("filled", {
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
});
