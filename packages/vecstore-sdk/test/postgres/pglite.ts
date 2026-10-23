import { afterAll, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

import type { VectorRecord } from "../../src/types";

const SUPABASE_SQL = fileURLToPath(
  new URL("../../sql/supabase.sql", import.meta.url)
);

export const createPostgres = (): PGlite =>
  new PGlite({ extensions: { vector } });

export const usePostgres = (
  setup?: (db: PGlite) => Promise<void>
): (() => PGlite) => {
  let db: PGlite | undefined;

  beforeAll(async () => {
    db = createPostgres();
    await setup?.(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  return () => {
    if (db === undefined) {
      throw new Error("postgres is not ready");
    }

    return db;
  };
};

export const ensureRoles = async (
  db: PGlite,
  names: readonly string[]
): Promise<void> => {
  const statements = names.map(
    (name) =>
      `do $$ begin if not exists (select 1 from pg_roles where rolname = '${name}') then create role ${name} nologin; end if; end $$`
  );

  await db.exec(statements.join(";"));
};

export const installSupabaseSql = async (db: PGlite): Promise<void> => {
  await db.exec(readFileSync(SUPABASE_SQL, "utf-8"));
};

export const FORCE_INDEX_SCAN =
  "set enable_seqscan = off; set enable_bitmapscan = off; set enable_sort = off";

export const AVOID_INDEX_SCAN = "set enable_indexscan = off";

export const zeroVectorRecords: VectorRecord[] = [
  { id: "zero", vector: [0, 0] },
  { id: "x", vector: [1, 0] },
  { id: "y", vector: [0, 1] },
  { id: "nx", vector: [-1, 0] },
];

export const NEAREST_FIRST_ZERO_LAST = ["x", "y", "nx", "zero"];

const SPREAD = 7;
const RARE_EVERY = 10;
const RECORDS_PER_NAMESPACE = 200;

export const spreadRecords = (prefix: string): VectorRecord[] =>
  Array.from({ length: RECORDS_PER_NAMESPACE }, (_, position) => ({
    id: `${prefix}-${position}`,
    metadata: { kind: position % RARE_EVERY === 0 ? "rare" : "common" },
    vector: [
      Math.cos(position),
      Math.sin(position),
      (position % SPREAD) / SPREAD,
    ],
  }));

export const isDescending = (scores: readonly number[]): boolean =>
  scores.every(
    (score, position) =>
      position === 0 || (scores[position - 1] ?? score) >= score
  );
