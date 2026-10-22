import type { StructuredData } from "fumadocs-core/mdx-plugins";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

// A table cell is sliced from the Markdown together with the pipe that opens
// it, and the last one with the pipe that closes the row. Search results render
// that Markdown, so the pipes show up as stray characters.
const TABLE_PIPES = /^\|\s*|\s*(?<!\\)\|$/gu;

const withoutTablePipes = ({
  contents,
  headings,
}: StructuredData): StructuredData => ({
  contents: contents.map((item) => ({
    ...item,
    content: item.content.replace(TABLE_PIPES, ""),
  })),
  headings,
});

export const { GET } = createFromSource(source, {
  buildIndex: (page) => ({
    description: page.data.description,
    id: page.url,
    structuredData: withoutTablePipes(page.data.structuredData),
    title: page.data.title,
    url: page.url,
  }),
});
