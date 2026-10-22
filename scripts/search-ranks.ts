// Rank check for the docs search. Fetches /api/search from one or more running
// builds of apps/web and reports where the page that documents each query lands.
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

const PROBES: readonly Probe[] = [
  { page: "/docs/core/filters", query: "filter" },
  { page: "/docs/core/store", query: "upsert" },
  { page: "/docs/core/filters", query: "eq" },
  { page: "/docs/guides/migration", query: "namespace" },
  { page: "/docs/providers/upstash", query: "namespace" },
  { page: "/docs/providers/qdrant", query: "qdrant" },
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

const rankOf = (results: readonly SearchResult[], page: string): string => {
  const index = results.findIndex((result) => pagePath(result.url) === page);
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
  const cells = found.map(
    ({ results }) => `${rankOf(results, page)} of ${results.length}`
  );
  console.log(`| \`${query}\` | \`${page}\` | ${cells.join(" | ")} |`);
}

if (top > 0) {
  for (const { found, query } of rows) {
    for (const { label, results } of found) {
      console.log(`\n${label} · ${query}`);
      for (const [index, result] of results.slice(0, top).entries()) {
        console.log(`  ${index + 1}. ${result.url}`);
      }
    }
  }
}
