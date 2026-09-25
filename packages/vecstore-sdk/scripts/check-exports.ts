import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };
import { isObjectLike } from "../src/internal/guards";

const PROVIDER_PACKAGES = [
  "@pinecone-database/pinecone",
  "@qdrant/js-client-rest",
  "@supabase/supabase-js",
  "@upstash/vector",
  "cloudflare",
  "redis",
  "pg",
] as const;

type ExportTarget =
  (typeof packageJson.exports)[keyof typeof packageJson.exports];
type ImportableTarget = Extract<ExportTarget, { import: string }>;
type ExportEntry = readonly [string, ExportTarget];
type ImportableEntry = readonly [string, ImportableTarget];

const hasImportField = (entry: ExportEntry): entry is ImportableEntry =>
  isObjectLike(entry[1]) && "import" in entry[1];

const root = new URL("../", import.meta.url);

const entries: ExportEntry[] = Object.entries(packageJson.exports);
const importableEntries = entries.filter(hasImportField);

const checkEntryExports = async ([
  subpath,
  target,
]: ImportableEntry): Promise<void> => {
  const file = fileURLToPath(new URL(target.import, root));
  const loaded = await import(file);
  if (Object.keys(loaded).length === 0) {
    throw new Error(
      `${subpath} resolved to ${target.import} but exports nothing`
    );
  }

  const source = readFileSync(file, "utf-8");
  for (const name of PROVIDER_PACKAGES) {
    if (
      source.includes(`from "${name}"`) ||
      source.includes(`import("${name}")`)
    ) {
      throw new Error(`${subpath} imports ${name} at runtime`);
    }
  }
};

await Promise.all(importableEntries.map(checkEntryExports));

process.stdout.write(`checked ${importableEntries.length} entries\n`);
