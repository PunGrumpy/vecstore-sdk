import { describe, expect, test } from "bun:test";

import { Index } from "@upstash/vector";

import type { UpstashNamespaceMode } from "../../src/upstash";
import { createUpstashStore } from "../../src/upstash";
import { liveCases, setupLive } from "./conformance";

const url = process.env.UPSTASH_VECTOR_REST_URL ?? "";
const token = process.env.UPSTASH_VECTOR_REST_TOKEN ?? "";
const enabled = process.env.VECSTORE_LIVE === "1" && url !== "" && token !== "";

const modes: UpstashNamespaceMode[] = ["metadata", "native"];

for (const namespaceMode of modes) {
  describe.skipIf(!enabled)(`upstash live (${namespaceMode})`, () => {
    const live = setupLive(() =>
      createUpstashStore({ client: new Index({ token, url }), namespaceMode })
    );

    test.each(liveCases)("%s", async (_name, run) => {
      await expect(run(live())).resolves.toBeUndefined();
    });
  });
}
