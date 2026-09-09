import { defineConfig, defineDocs } from "fumadocs-mdx/config";

import { geistShikiTheme } from "./lib/shiki-theme";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { dark: geistShikiTheme, light: geistShikiTheme },
    },
  },
});
