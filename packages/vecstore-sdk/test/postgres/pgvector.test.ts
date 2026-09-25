import { afterAll, describe, expect, test } from "bun:test";

import { createPgvectorStore } from "../../src/pgvector";
import { containsCases, liveCases, setupLive } from "../live/conformance";
import { createPostgres } from "./pglite";

describe("pgvector on PGlite", () => {
  const db = createPostgres();
  const live = setupLive(() => createPgvectorStore({ client: db }));
  afterAll(() => db.close());

  test.each([...containsCases, ...liveCases])("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});
