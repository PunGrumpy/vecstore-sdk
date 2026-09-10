import { describe, expect, test } from "bun:test";

import { createClient } from "@supabase/supabase-js";

import { createSupabaseStore } from "../../src/supabase";
import { liveCases, setupLive } from "./conformance";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled =
  process.env.VECSTORE_LIVE === "1" && url !== undefined && key !== undefined;

describe.skipIf(!enabled)("supabase live", () => {
  const live = setupLive(() =>
    createSupabaseStore({ client: createClient(url ?? "", key ?? "") })
  );

  test.each(liveCases)("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});
