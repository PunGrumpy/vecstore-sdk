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
    // fumadocs 16.17 indexes a table as one record per row, header row included.
    // Those records are long, so a query for an API name that sits in a table
    // cell scores below short headings elsewhere and the page that documents
    // it drops down the results. Index each cell on its own, as 16.15 did.
    remarkStructureOptions: {
      types: [
        "heading",
        "paragraph",
        "blockquote",
        "tableCell",
        "mdxJsxFlowElement",
      ],
    },
  },
});
