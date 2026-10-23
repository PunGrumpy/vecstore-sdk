// Rank check for the docs search. Fetches /api/search from one or more running
// builds of apps/web and reports where the page that documents each query lands.
// The search lists a page followed by its hits, so a page ranks by where its
// first result appears among the distinct pages, not by its index in the list.
//
//   bun scripts/search-ranks.ts main=http://localhost:3000
//   bun scripts/search-ranks.ts before=http://localhost:4061 after=http://localhost:4062
//   bun scripts/search-ranks.ts --top 8 after=http://localhost:3000
//
// Start a build with `bun run build && bun run start` inside apps/web.
import { parseArgs } from "node:util";

interface Probe {
  readonly query: string;
  readonly page: string;
}

interface Target {
  readonly label: string;
  readonly base: string;
}

interface SearchResult {
  readonly url: string;
}

const STORE = "/docs/core/store";

const PROBES: readonly Probe[] = [
  // A concept or an API name, documented on one page.
  { page: "/docs/core/filters", query: "filter" },
  { page: STORE, query: "upsert" },
  { page: "/docs/core/filters", query: "eq" },
  { page: "/docs/guides/migration", query: "namespace" },
  { page: "/docs/providers/upstash", query: "namespace" },
  // A provider name, which is also a column header in the comparison tables.
  { page: "/docs/providers/pinecone", query: "pinecone" },
  { page: "/docs/providers/redis", query: "redis" },
  { page: "/docs/providers/vectorize", query: "vectorize" },
  { page: "/docs/providers/upstash", query: "upstash" },
  { page: "/docs/providers/supabase", query: "supabase" },
  { page: "/docs/providers/pgvector", query: "pgvector" },
  { page: "/docs/providers/qdrant", query: "qdrant" },
  // Queries that never regressed, to catch a change that makes them worse.
  { page: STORE, query: "createIndex" },
  { page: STORE, query: "topK" },
  { page: "/docs/getting-started", query: "install" },
  { page: STORE, query: "delete" },
];

const pagePath = (url: string): string => url.split("#")[0] ?? url;

const search = async (base: string, query: string): Promise<SearchResult[]> => {
  const url = `${base}/api/search?query=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  // SAFETY: /api/search returns a JSON array of results that each carry a `url`.
  return (await response.json()) as SearchResult[];
};

const pagesOf = (results: readonly SearchResult[]): string[] => [
  ...new Set(results.map((result) => pagePath(result.url))),
];

const rankOf = (pages: readonly string[], page: string): string => {
  const index = pages.indexOf(page);
  return index === -1 ? "-" : `#${index + 1}`;
};

const parseTarget = (arg: string): Target => {
  const separator = arg.indexOf("=");
  const label = arg.slice(0, separator);
  const base = arg.slice(separator + 1).replace(/\/$/u, "");
  if (separator < 1 || !base) {
    throw new Error(`Expected <label>=<base url>, got "${arg}"`);
  }
  return { base, label };
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { top: { default: "0", type: "string" } },
});

if (positionals.length === 0) {
  throw new Error(
    "Usage: bun scripts/search-ranks.ts [--top N] <label>=<base url> ..."
  );
}

const targets = positionals.map(parseTarget);
const top = Number(values.top);

const rows = await Promise.all(
  PROBES.map(async ({ page, query }) => ({
    found: await Promise.all(
      targets.map(async ({ base, label }) => ({
        label,
        results: await search(base, query),
      }))
    ),
    page,
    query,
  }))
);

console.log(
  `| query | page | ${targets.map((target) => target.label).join(" | ")} |`
);
console.log(`| --- | --- | ${targets.map(() => "---").join(" | ")} |`);
for (const { found, page, query } of rows) {
  const cells = found.map(({ results }) => {
    const pages = pagesOf(results);
    return `${rankOf(pages, page)} of ${pages.length}`;
  });
  console.log(`| \`${query}\` | \`${page}\` | ${cells.join(" | ")} |`);
}

if (top > 0) {
  for (const { found, query } of rows) {
    for (const { label, results } of found) {
      console.log(`\n${label} · ${query}`);
      for (const [index, page] of pagesOf(results).slice(0, top).entries()) {
        console.log(`  ${index + 1}. ${page}`);
      }
    }
  }
}
