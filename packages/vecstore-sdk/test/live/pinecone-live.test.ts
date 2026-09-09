import { describe, expect, test } from "bun:test";

import { Pinecone } from "@pinecone-database/pinecone";

import { createPineconeStore } from "../../src/pinecone";
import { liveCases, setupLive } from "./conformance";

const apiKey = process.env.PINECONE_API_KEY ?? "";
const enabled = process.env.VECSTORE_LIVE === "1" && apiKey !== "";

describe.skipIf(!enabled)("pinecone live", () => {
  const live = setupLive(() =>
    createPineconeStore({ client: new Pinecone({ apiKey }) })
  );

  test.each(liveCases)("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});
