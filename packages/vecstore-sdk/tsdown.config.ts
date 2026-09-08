import { defineConfig } from "tsdown";

export default defineConfig({
  banner: {
    js: "#!/usr/bin/env node",
  },
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["esm"],
  minify: false,
  platform: "node",
  shims: true,
  sourcemap: true,
  target: "es2018",
});
