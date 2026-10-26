import type { StructuredData } from "fumadocs-core/mdx-plugins";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

// A table cell is sliced from the Markdown together with the pipe that opens
// it, and the last one with the pipe that closes the row. Search results render
// that Markdown, so the pipes show up as stray characters.
const stripTablePipes = (content: string): string => {
  const opened = content.startsWith("|")
    ? content.slice(1).trimStart()
    : content;

  return opened.endsWith("|") && !opened.endsWith("\\|")
    ? opened.slice(0, -1).trimEnd()
    : opened;
};

// The index has one `content` field, so a page title weighs the same as any
// other record and BM25 favours the shorter one. A table header cell such as
// `Pinecone` ties with the title of the Pinecone page, and scores above a
// longer title such as `Upstash Vector`, so the provider page drops below the
// comparison tables. Fumadocs' simple search boosts the title field for this
// reason. The advanced search takes no per-field boost, so scale the score of
// a page record before sorting. Any value from 1.1 to 4 ranks the same here.
const PAGE_TITLE_BOOST = 1.5;

const withoutTablePipes = ({
  contents,
  headings,
}: StructuredData): StructuredData => ({
  contents: contents.map((item) => ({
    ...item,
    content: stripTablePipes(item.content),
  })),
  headings,
});

const boosted = (score: number, type: string): number =>
  type === "page" ? score * PAGE_TITLE_BOOST : score;

export const { GET } = createFromSource(source, {
  buildIndex: (page) => ({
    description: page.data.description,
    id: page.url,
    structuredData: withoutTablePipes(page.data.structuredData),
    title: page.data.title,
    url: page.url,
  }),
  search: {
    sortBy: ([idA, scoreA, docA], [idB, scoreB, docB]) =>
      boosted(scoreB, docB.type) - boosted(scoreA, docA.type) || idA - idB,
  },
});
