import { defineConfig } from "tsdown";

import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  clean: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
  },
  dts: true,
  entry: {
    index: "src/index.ts",
    pgvector: "src/pgvector/index.ts",
    pinecone: "src/pinecone/index.ts",
    qdrant: "src/qdrant/index.ts",
    upstash: "src/upstash/index.ts",
  },
  format: ["esm"],
  minify: false,
  platform: "node",
  sourcemap: true,
  target: "es2022",
});
