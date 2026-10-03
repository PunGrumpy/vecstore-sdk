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

export const installSupabaseSql = async (db: PGlite): Promise<void> => {
  await db.exec(readFileSync(SUPABASE_SQL, "utf-8"));
};

export const FORCE_INDEX_SCAN =
  "set enable_seqscan = off; set enable_bitmapscan = off; set enable_sort = off";

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
