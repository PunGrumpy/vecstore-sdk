import { describe, expect, test } from "bun:test";

import { QdrantClient } from "@qdrant/js-client-rest";

import { createQdrantStore } from "../../src/qdrant";
import { containsCases, liveCases, setupLive } from "./conformance";

const url = process.env.QDRANT_URL;
const enabled = process.env.VECSTORE_LIVE === "1" && url !== undefined;

describe.skipIf(!enabled)("qdrant live", () => {
  const live = setupLive(() =>
    createQdrantStore({
      client: new QdrantClient({ apiKey: process.env.QDRANT_API_KEY, url }),
    })
  );

  test.each([...containsCases, ...liveCases])("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});
