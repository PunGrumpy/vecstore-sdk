import {
  defineCollections,
  defineConfig,
  defineDocs,
  frontmatterSchema,
} from "fumadocs-mdx/config";
import { z } from "zod";

import { geistShikiTheme } from "./lib/shiki-theme";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export const changelog = defineCollections({
  dir: "content/changelog",
  postprocess: {
    includeProcessedMarkdown: true,
  },
  schema: frontmatterSchema.extend({
    date: z.coerce.date(),
    description: z.string(),
    version: z.string(),
  }),
  type: "doc",
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: { dark: geistShikiTheme, light: geistShikiTheme },
    },
  },
});
