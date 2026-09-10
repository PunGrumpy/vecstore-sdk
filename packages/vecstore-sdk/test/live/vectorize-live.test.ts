import { describe, expect, test } from "bun:test";

import Cloudflare from "cloudflare";

import { createVectorizeStore } from "../../src/vectorize";
import { liveCases, setupLive } from "./conformance";

const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const enabled =
  process.env.VECSTORE_LIVE === "1" && apiToken !== "" && accountId !== "";

const DELETE_ALL_CASE = "delete all empties the namespace";

const cases = liveCases.filter(([name]) => name !== DELETE_ALL_CASE);

describe.skipIf(!enabled)("vectorize live", () => {
  const live = setupLive(
    () =>
      createVectorizeStore({
        accountId,
        client: new Cloudflare({ apiToken }),
        metadataIndexes: [
          { property: "genre", type: "string" },
          { property: "year", type: "number" },
        ],
      }),
    { indexName: () => `vecstore-live-${Date.now()}` }
  );

  test.each(cases)("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });

  test("delete all reports that Vectorize cannot empty a namespace", async () => {
    await expect(live().index.delete({ all: true })).resolves.toMatchObject({
      error: { feature: "deleteAll", kind: "unsupported" },
      ok: false,
    });
  });
});
