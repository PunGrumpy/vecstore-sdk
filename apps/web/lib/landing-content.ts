export type ProviderId =
  | "qdrant"
  | "pgvector"
  | "pinecone"
  | "supabase"
  | "upstash";

export const installCommand = "bun add vecstore-sdk";

export const githubUrl = "https://github.com/PunGrumpy/vecstore-sdk";
export const npmUrl = "https://www.npmjs.com/package/vecstore-sdk";

export interface DemoProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly snippet: (expression: string) => string;
}

export interface DemoExample {
  readonly id: string;
  readonly label: string;
  readonly expression: string;
  readonly filterCode: string;
  readonly output: Readonly<Record<string, string>>;
}

const builders = [
  "and",
  "eq",
  "exists",
  "gt",
  "gte",
  "isIn",
  "lt",
  "lte",
  "ne",
  "not",
  "notIn",
  "or",
] as const;

const builderImports = (expression: string) =>
  builders
    .filter((name) => new RegExp(`\\b${name}\\(`, "u").test(expression))
    .join(", ");

const query = (
  expression: string
) => `const result = await store.index("docs").query({
  vector,
  topK: 5,
  filter: ${expression},
});`;

export const demoProviders: readonly DemoProvider[] = [
  {
    id: "qdrant",
    label: "Qdrant",
    snippet: (
      expression
    ) => `import { QdrantClient } from "@qdrant/js-client-rest";
import { ${builderImports(expression)} } from "vecstore-sdk";
import { createQdrantStore } from "vecstore-sdk/qdrant";

const store = createQdrantStore({
  client: new QdrantClient({ url }),
});

${query(expression)}`,
  },
  {
    id: "pgvector",
    label: "pgvector",
    snippet: (expression) => `import { Pool } from "pg";
import { ${builderImports(expression)} } from "vecstore-sdk";
import { createPgvectorStore } from "vecstore-sdk/pgvector";

const store = createPgvectorStore({
  client: new Pool({ connectionString }),
});

${query(expression)}`,
  },
  {
    id: "pinecone",
    label: "Pinecone",
    snippet: (
      expression
    ) => `import { Pinecone } from "@pinecone-database/pinecone";
import { ${builderImports(expression)} } from "vecstore-sdk";
import { createPineconeStore } from "vecstore-sdk/pinecone";

const store = createPineconeStore({
  client: new Pinecone({ apiKey }),
});

${query(expression)}`,
  },
  {
    id: "supabase",
    label: "Supabase",
    snippet: (
      expression
    ) => `import { createClient } from "@supabase/supabase-js";
import { ${builderImports(expression)} } from "vecstore-sdk";
import { createSupabaseStore } from "vecstore-sdk/supabase";

const store = createSupabaseStore({
  client: createClient(url, key),
});

${query(expression)}`,
  },
  {
    id: "upstash",
    label: "Upstash",
    snippet: (expression) => `import { Index } from "@upstash/vector";
import { ${builderImports(expression)} } from "vecstore-sdk";
import { createUpstashStore } from "vecstore-sdk/upstash";

const store = createUpstashStore({
  client: new Index({ url, token }),
});

${query(expression)}`,
  },
];

export const demoExamples: readonly DemoExample[] = [
  {
    expression: 'and(eq("genre", "drama"), gt("year", 2000))',
    filterCode: `and(
    eq("genre", "drama"),
    gt("year", 2000)
  )`,
    id: "match",
    label: "Match",
    output: {
      pgvector: `(metadata @> $1::jsonb
  AND (jsonb_typeof((metadata->$2::text))
        = 'number'
    AND (metadata->$2::text) > $3::jsonb))

$1 = '{"genre":"drama"}'
$2 = 'year'
$3 = '2000'`,
      pinecone: `{
  "$and": [
    { "genre": { "$eq": "drama" } },
    { "year": { "$gt": 2000 } }
  ]
}`,
      qdrant: `{
  "must": [
    {
      "key": "genre",
      "match": { "value": "drama" }
    },
    {
      "key": "year",
      "range": { "gt": 2000 }
    }
  ]
}`,
      supabase: `(metadata @> '{"genre": "drama"}'::jsonb
  AND (jsonb_typeof((metadata -> 'year'::text))
        = 'number'
    AND (metadata -> 'year'::text) > '2000'::jsonb))`,
      upstash: `(genre = 'drama' AND year > 2000)`,
    },
  },
  {
    expression: 'and(gte("price", 10), lte("price", 100))',
    filterCode: `and(
    gte("price", 10),
    lte("price", 100)
  )`,
    id: "range",
    label: "Range",
    output: {
      pgvector: `((jsonb_typeof((metadata->$1::text))
        = 'number'
    AND (metadata->$1::text) >= $2::jsonb)
  AND (jsonb_typeof((metadata->$3::text))
        = 'number'
    AND (metadata->$3::text) <= $4::jsonb))

$1 = 'price'   $2 = '10'
$3 = 'price'   $4 = '100'`,
      pinecone: `{
  "$and": [
    { "price": { "$gte": 10 } },
    { "price": { "$lte": 100 } }
  ]
}`,
      qdrant: `{
  "must": [
    {
      "key": "price",
      "range": { "gte": 10 }
    },
    {
      "key": "price",
      "range": { "lte": 100 }
    }
  ]
}`,
      supabase: `((jsonb_typeof((metadata -> 'price'::text))
      = 'number'
  AND (metadata -> 'price'::text) >= '10'::jsonb)
  AND (jsonb_typeof((metadata -> 'price'::text))
      = 'number'
  AND (metadata -> 'price'::text) <= '100'::jsonb))`,
      upstash: `(price >= 10 AND price <= 100)`,
    },
  },
  {
    expression: 'and(isIn("lang", ["en", "th"]), notIn("status", ["draft"]))',
    filterCode: `and(
    isIn("lang", ["en", "th"]),
    notIn("status", ["draft"])
  )`,
    id: "sets",
    label: "Sets",
    output: {
      pgvector: `((metadata->$1::text) <@ $2::jsonb
  AND NOT COALESCE(
    (metadata->$3::text) <@ $4::jsonb,
    false))

$1 = 'lang'    $2 = '["en","th"]'
$3 = 'status'  $4 = '["draft"]'`,
      pinecone: `{
  "$and": [
    { "lang": { "$in": ["en", "th"] } },
    { "status": { "$nin": ["draft"] } }
  ]
}`,
      qdrant: `{
  "must": [
    {
      "key": "lang",
      "match": { "any": ["en", "th"] }
    },
    {
      "key": "status",
      "match": { "except": ["draft"] }
    }
  ]
}`,
      supabase: `((metadata -> 'lang'::text)
    <@ '["en", "th"]'::jsonb
  AND NOT COALESCE(
    (metadata -> 'status'::text) <@ '["draft"]'::jsonb,
    false))`,
      upstash: `(lang IN ('en', 'th') AND status NOT IN ('draft'))`,
    },
  },
  {
    expression: 'or(eq("tier", "pro"), not(eq("region", "eu")))',
    filterCode: `or(
    eq("tier", "pro"),
    not(eq("region", "eu"))
  )`,
    id: "logic",
    label: "Logic",
    output: {
      pgvector: `(metadata @> $1::jsonb
  OR NOT (metadata @> $2::jsonb))

$1 = '{"tier":"pro"}'
$2 = '{"region":"eu"}'`,
      pinecone: `{
  "$or": [
    { "tier": { "$eq": "pro" } },
    { "region": { "$ne": "eu" } }
  ]
}`,
      qdrant: `{
  "should": [
    {
      "key": "tier",
      "match": { "value": "pro" }
    },
    {
      "must_not": [
        {
          "key": "region",
          "match": { "value": "eu" }
        }
      ]
    }
  ]
}`,
      supabase: `(metadata @> '{"tier": "pro"}'::jsonb
  OR NOT (metadata @> '{"region": "eu"}'::jsonb))`,
      upstash: `(tier = 'pro' OR region != 'eu')`,
    },
  },
];

export const stats = [
  { label: "Providers", value: "5" },
  { label: "Filter builders", value: "12" },
  { label: "Runtime dependencies", value: "0" },
  { label: "License", value: "MIT" },
] as const;

export const highlights = [
  {
    body: "Write and, or, not, eq, gt, isIn once. Each adapter emits the provider's native syntax.",
    title: "One filter, compiled natively.",
  },
  {
    body: "Every call returns a Result. Match on the error kind instead of catching provider exceptions.",
    title: "Errors as values, never thrown.",
  },
  {
    body: "Pinecone and Upstash have them. Qdrant, pgvector, and Supabase get them emulated with the same API.",
    title: "Namespaces on every provider.",
  },
] as const;

export const switchCode = `import { Pool } from "pg";
import { createPgvectorStore } from "vecstore-sdk/pgvector";

const store = createPgvectorStore({
  client: new Pool({ connectionString }),
});

const docs = store.index("docs", { namespace: "tenant_1" });

await docs.upsert([{ id: "doc-1", vector, metadata: { genre: "drama" } }]);

const result = await docs.query({ vector, topK: 5 });

if (!result.ok) {
  switch (result.error.kind) {
    case "not_found":
      return [];
    default:
      throw new Error(result.error.message);
  }
}`;

export const verbs = [
  "upsert",
  "query",
  "fetch",
  "delete",
  "createIndex",
  "deleteIndex",
  "listIndexes",
  "index",
] as const;

export const adapters: readonly {
  readonly body: string;
  readonly command: string;
  readonly mark: ProviderId | "vecstore";
  readonly title: string;
}[] = [
  {
    body: "Wraps QdrantClient. Maps string ids to UUID point ids and emulates namespaces with a payload key.",
    command: "bun add @qdrant/js-client-rest",
    mark: "qdrant",
    title: "Qdrant",
  },
  {
    body: "Wraps a pg Pool or Client. Compiles filters to JSONB predicates and stores namespaces in a column.",
    command: "bun add pg",
    mark: "pgvector",
    title: "pgvector",
  },
  {
    body: "Wraps the Pinecone client. Uses native namespaces and metadata filters directly.",
    command: "bun add @pinecone-database/pinecone",
    mark: "pinecone",
    title: "Pinecone",
  },
  {
    body: "Calls SQL functions over supabase-js, so vector search runs in Edge Functions and the browser.",
    command: "bun add @supabase/supabase-js",
    mark: "supabase",
    title: "Supabase",
  },
  {
    body: "Wraps the Upstash Index. Maps an index to a namespace and compiles filters to the SQL-like filter string.",
    command: "bun add @upstash/vector",
    mark: "upstash",
    title: "Upstash Vector",
  },
  {
    body: "The core package ships the filter language and the adapter interface with no runtime dependencies.",
    command: installCommand,
    mark: "vecstore",
    title: "vecstore-sdk",
  },
];

export const guides = [
  {
    body: "Install the package with your provider SDK and run a filtered query in under a minute.",
    href: "/docs/getting-started",
    title: "Getting started",
  },
  {
    body: "Move from Qdrant to pgvector or Pinecone by changing one import and one config object.",
    href: "/docs/getting-started#switch-providers",
    title: "Switch providers",
  },
  {
    body: "Read the design notes, open an issue, or send a pull request on GitHub.",
    href: githubUrl,
    title: "Contribute",
  },
] as const;

export const footerColumns = [
  {
    links: [
      { href: "/docs", label: "Introduction" },
      { href: "/docs/getting-started", label: "Getting started" },
    ],
    title: "Docs",
  },
  {
    links: [
      { href: githubUrl, label: "GitHub" },
      { href: npmUrl, label: "npm" },
      { href: `${githubUrl}/releases`, label: "Changelog" },
      { href: `${githubUrl}/issues`, label: "Issues" },
    ],
    title: "Resources",
  },
  {
    links: [
      { href: "https://qdrant.tech", label: "Qdrant" },
      { href: "https://github.com/pgvector/pgvector", label: "pgvector" },
      { href: "https://www.pinecone.io", label: "Pinecone" },
      { href: "https://supabase.com/docs/guides/ai", label: "Supabase" },
      { href: "https://upstash.com/docs/vector", label: "Upstash Vector" },
    ],
    title: "Providers",
  },
  {
    links: [{ href: `${githubUrl}/blob/main/LICENSE`, label: "MIT License" }],
    title: "Legal",
  },
] as const;
