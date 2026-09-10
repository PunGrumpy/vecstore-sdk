import { afterAll, beforeAll, expect } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

import { and, eq, gt, isIn, not } from "../../src/filter/ast";
import type { VectorIndex, VectorRecord, VectorStore } from "../../src/types";

export type LiveStore = Pick<
  VectorStore<never>,
  "createIndex" | "deleteIndex" | "index" | "listIndexes"
>;

export interface Live {
  readonly index: VectorIndex;
  readonly indexName: string;
  readonly store: LiveStore;
}

export type LiveCase = [string, (live: Live) => Promise<void>];

export interface LiveOptions {
  readonly indexName?: () => string;
}

const DIMENSION = 3;
const READY_RETRIES = 20;
const READY_DELAY_MS = 500;
const NAMESPACE = "tenant-a";

const vectors = {
  a: [1, 0, 0],
  b: [0.9, 0.1, 0],
  c: [0, 1, 0],
  d: [0, 0, 1],
};

const records: VectorRecord[] = [
  { id: "doc-a", metadata: { genre: "drama", year: 1999 }, vector: vectors.a },
  { id: "doc-b", metadata: { genre: "drama", year: 2010 }, vector: vectors.b },
  { id: "doc-c", metadata: { genre: "comedy", year: 2015 }, vector: vectors.c },
  {
    id: "doc-d",
    metadata: { genre: "horror", tags: ["x", "y"] },
    vector: vectors.d,
  },
];

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: object }
): T => {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.value;
};

const idsOf = (matches: readonly { readonly id: string }[]): string[] =>
  matches.map((match) => match.id);

const waitForRecords = async (
  index: VectorIndex,
  attempt = 0
): Promise<void> => {
  const found = unwrap(await index.fetch(["doc-a", "doc-d"]));
  if (found.length === 2) {
    return;
  }
  if (attempt >= READY_RETRIES) {
    throw new Error("records did not become visible in time");
  }
  await sleep(READY_DELAY_MS);
  await waitForRecords(index, attempt + 1);
};

export const setupLive = (
  makeStore: () => LiveStore,
  options: LiveOptions = {}
): (() => Live) => {
  let live: Live | undefined;

  beforeAll(async () => {
    const store = makeStore();
    const indexName = options.indexName?.() ?? `vecstore_live_${Date.now()}`;
    unwrap(await store.createIndex({ dimension: DIMENSION, name: indexName }));
    const index = store.index(indexName, { namespace: NAMESPACE });
    unwrap(await index.upsert(records));
    await waitForRecords(index);
    live = { index, indexName, store };
  });

  afterAll(async () => {
    if (live !== undefined) {
      unwrap(await live.store.deleteIndex(live.indexName));
    }
  });

  return () => {
    if (live === undefined) {
      throw new Error("live store is not ready");
    }
    return live;
  };
};

export const liveCases: LiveCase[] = [
  [
    "listIndexes includes the new index",
    async ({ store, indexName }) => {
      expect(unwrap(await store.listIndexes())).toContain(indexName);
    },
  ],
  [
    "query ranks the nearest vector first",
    async ({ index }) => {
      const matches = unwrap(await index.query({ topK: 2, vector: vectors.a }));
      expect(idsOf(matches)).toStrictEqual(["doc-a", "doc-b"]);
    },
  ],
  [
    "query applies equality and range filters",
    async ({ index }) => {
      const matches = unwrap(
        await index.query({
          filter: and(eq("genre", "drama"), gt("year", 2000)),
          topK: 10,
          vector: vectors.a,
        })
      );
      expect(idsOf(matches)).toStrictEqual(["doc-b"]);
    },
  ],
  [
    "query applies membership and negation filters",
    async ({ index }) => {
      const matches = unwrap(
        await index.query({
          filter: not(isIn("genre", ["drama", "comedy"])),
          topK: 10,
          vector: vectors.d,
        })
      );
      expect(idsOf(matches)).toStrictEqual(["doc-d"]);
    },
  ],
  [
    "query returns metadata and the vector when asked",
    async ({ index }) => {
      const [match] = unwrap(
        await index.query({
          filter: eq("genre", "horror"),
          includeVector: true,
          topK: 1,
          vector: vectors.d,
        })
      );
      expect(match?.metadata).toStrictEqual({
        genre: "horror",
        tags: ["x", "y"],
      });
      expect(match?.vector?.map(Math.round)).toStrictEqual(vectors.d);
    },
  ],
  [
    "fetch returns records in request order and skips misses",
    async ({ index }) => {
      const found = unwrap(await index.fetch(["doc-c", "missing", "doc-a"]));
      expect(idsOf(found)).toStrictEqual(["doc-c", "doc-a"]);
    },
  ],
  [
    "another namespace sees nothing",
    async ({ store, indexName }) => {
      const other = store.index(indexName, { namespace: "tenant-b" });
      const matches = unwrap(
        await other.query({ topK: 10, vector: vectors.a })
      );
      expect(matches).toStrictEqual([]);
    },
  ],
  [
    "delete by id removes only that record",
    async ({ index }) => {
      unwrap(await index.delete({ ids: ["doc-c"] }));
      const found = unwrap(await index.fetch(["doc-c", "doc-a"]));
      expect(idsOf(found)).toStrictEqual(["doc-a"]);
    },
  ],
  [
    "delete all empties the namespace",
    async ({ index }) => {
      unwrap(await index.delete({ all: true }));
      await sleep(READY_DELAY_MS);
      const matches = unwrap(
        await index.query({ topK: 10, vector: vectors.a })
      );
      expect(matches).toStrictEqual([]);
    },
  ],
];
