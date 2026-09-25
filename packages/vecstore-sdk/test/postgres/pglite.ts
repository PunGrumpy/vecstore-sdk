import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

const SUPABASE_SQL = fileURLToPath(
  new URL("../../sql/supabase.sql", import.meta.url)
);

export const createPostgres = (): PGlite =>
  new PGlite({ extensions: { vector } });

export const installSupabaseSql = async (db: PGlite): Promise<void> => {
  await db.exec(readFileSync(SUPABASE_SQL, "utf-8"));
};
