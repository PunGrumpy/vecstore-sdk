import { getChangelogEntries } from "@/lib/changelog";
import { url } from "@/lib/url";

export const revalidate = false;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const handler = () => {
  const entries = getChangelogEntries();
  const items = entries
    .map(
      (entry) => `    <item>
      <title>${escapeXml(`v${entry.data.version}: ${entry.data.title}`)}</title>
      <link>${url}${entry.url}</link>
      <guid isPermaLink="true">${url}${entry.url}</guid>
      <pubDate>${entry.data.date.toUTCString()}</pubDate>
      <description>${escapeXml(entry.data.description)}</description>
    </item>`
    )
    .join("\n");
  const lastBuildDate = entries[0]?.data.date.toUTCString() ?? "";

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>VecStore SDK Changelog</title>
    <link>${url}/changelog</link>
    <atom:link href="${url}/changelog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Every VecStore SDK release, newest first.</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(feed, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};

export { handler as GET };
