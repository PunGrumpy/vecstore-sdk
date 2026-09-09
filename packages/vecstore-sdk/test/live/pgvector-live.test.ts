import { afterAll, describe, expect, test } from "bun:test";

import { Pool } from "pg";

import { createPgvectorStore } from "../../src/pgvector";
import { liveCases, setupLive } from "./conformance";

const connectionString = process.env.PGVECTOR_URL;
const enabled =
  process.env.VECSTORE_LIVE === "1" && connectionString !== undefined;

describe.skipIf(!enabled)("pgvector live", () => {
  const pool = new Pool({ connectionString });

  afterAll(() => pool.end());
  const live = setupLive(() => createPgvectorStore({ client: pool }));

  test.each(liveCases)("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});
