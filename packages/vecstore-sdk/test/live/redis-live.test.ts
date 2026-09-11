import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createClient } from "redis";

import { eq, exists, not } from "../../src/filter/ast";
import type { RedisMetadataField } from "../../src/redis";
import { createRedisStore } from "../../src/redis";
import type { ScoredRecord, VectorRecord } from "../../src/types";
import { liveCases, setupLive } from "./conformance";

const url = process.env.REDIS_URL ?? "";
const enabled = process.env.VECSTORE_LIVE === "1" && url !== "";

const DIMENSION = 3;

const metadataFields: RedisMetadataField[] = [
  { field: "genre", type: "tag" },
  { field: "tags", type: "tag" },
  { field: "wireless", type: "tag" },
  { field: "year", type: "numeric" },
];

const records: VectorRecord[] = [
  {
    id: "doc-a",
    metadata: { genre: "drama", tags: ["x", "y"], wireless: true, year: 1999 },
    vector: [1, 0, 0],
  },
  { id: "doc-b", metadata: { genre: "comedy", year: 2010 }, vector: [0, 1, 0] },
];

const client = createClient({ url });

if (enabled) {
  await client.connect();
}

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: object }
): T => {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

const idsOf = (matches: readonly ScoredRecord[]): string[] =>
  matches.map((match) => match.id);

describe.skipIf(!enabled)("redis live", () => {
  const live = setupLive(() => createRedisStore({ client, metadataFields }));

  test.each(liveCases)("%s", async (_name, run) => {
    await expect(run(live())).resolves.toBeUndefined();
  });
});

describe.skipIf(!enabled)("redis live filters", () => {
  const store = createRedisStore({ client, metadataFields });
  const name = `vecstore_live_filters_${Date.now()}`;
  const index = store.index(name);

  beforeAll(async () => {
    unwrap(await store.createIndex({ dimension: DIMENSION, name }));
    unwrap(await index.upsert(records));
  });

  afterAll(async () => {
    unwrap(await store.deleteIndex(name));
  });

  test("the default namespace holds its own records", async () => {
    const matches = unwrap(await index.query({ topK: 10, vector: [1, 0, 0] }));
    const other = store.index(name, { namespace: "tenant-a" });
    expect(idsOf(matches)).toStrictEqual(["doc-a", "doc-b"]);
    expect(
      unwrap(await other.query({ topK: 10, vector: [1, 0, 0] }))
    ).toStrictEqual([]);
  });

  test("exists tells a missing field from a present one", async () => {
    const present = unwrap(
      await index.query({ filter: exists("tags"), topK: 10, vector: [1, 0, 0] })
    );
    const missing = unwrap(
      await index.query({
        filter: not(exists("tags")),
        topK: 10,
        vector: [1, 0, 0],
      })
    );
    expect(idsOf(present)).toStrictEqual(["doc-a"]);
    expect(idsOf(missing)).toStrictEqual(["doc-b"]);
  });

  test("eq on a list field matches one element", async () => {
    const matches = unwrap(
      await index.query({
        filter: eq("tags", "x"),
        topK: 10,
        vector: [1, 0, 0],
      })
    );
    expect(idsOf(matches)).toStrictEqual(["doc-a"]);
  });

  test("eq on a boolean field matches the stored value", async () => {
    const matches = unwrap(
      await index.query({
        filter: eq("wireless", true),
        topK: 10,
        vector: [1, 0, 0],
      })
    );
    expect(idsOf(matches)).toStrictEqual(["doc-a"]);
  });

  test("delete by filter removes the matches and leaves the rest", async () => {
    unwrap(await index.delete({ filter: eq("genre", "comedy") }));
    const matches = unwrap(await index.query({ topK: 10, vector: [1, 0, 0] }));
    expect(idsOf(matches)).toStrictEqual(["doc-a"]);
  });
});

afterAll(async () => {
  if (enabled) {
    await client.close();
  }
});
