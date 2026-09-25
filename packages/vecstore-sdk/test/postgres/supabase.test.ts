import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { PGlite } from "@electric-sql/pglite";

import { errorMessage } from "../../src/errors";
import { isBoolean, isNumber, isString } from "../../src/internal/guards";
import { hasCode } from "../../src/internal/postgres";
import type { SupabaseCall, SupabaseClientLike } from "../../src/supabase";
import { createSupabaseStore } from "../../src/supabase";
import { liveCases, setupLive } from "../live/conformance";
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

  test.each(liveCases)("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});
