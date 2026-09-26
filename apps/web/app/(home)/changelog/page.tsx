import { ArrowUpRightIcon, RssIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { formatChangelogDate, getChangelogEntries } from "@/lib/changelog";

const description =
  "Every VecStore SDK release, newest first: new adapters, filter semantics, and the fixes that keep seven providers behaving like one library.";

export const metadata: Metadata = {
  alternates: { types: { "application/rss+xml": "/changelog/rss.xml" } },
  description,
  openGraph: {
    description,
    images: "/opengraph-image.png",
    siteName: "VecStore SDK",
    type: "website",
    url: "/changelog",
  },
  title: "Changelog",
  twitter: {
    card: "summary_large_image",
    description,
    images: "/opengraph-image.png",
  },
};

const Changelog = () => {
  const entries = getChangelogEntries();

  return (
    <div className="mx-auto w-full max-w-[1120px] px-6 pt-20 pb-24">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-heading-40 md:text-heading-56 text-gray-1000">
            Changelog
          </h1>
          <p className="text-copy-20 mt-4 max-w-xl text-gray-900">
            New adapters, filter semantics, and fixes, one entry per release.
          </p>
        </div>
        <Link
          className="text-label-14 hover:text-gray-1000 inline-flex items-center gap-2 text-gray-900 transition-colors"
          href="/changelog/rss.xml"
          prefetch={false}
        >
          <RssIcon aria-hidden className="size-4" />
          RSS feed
        </Link>
      </div>
      <ol className="mt-16 flex flex-col">
        {entries.map((entry) => (
          <li
            className="border-gray-alpha-400 grid grid-cols-1 gap-4 border-t py-12 first:border-t-0 first:pt-0 md:grid-cols-[200px_1fr] md:gap-12"
            key={entry.url}
          >
            <div className="flex flex-row items-center gap-3 self-start md:sticky md:top-24 md:flex-col md:items-start">
              <time
                className="text-label-14 text-gray-900"
                dateTime={entry.data.date.toISOString()}
              >
                {formatChangelogDate(entry.data.date)}
              </time>
              <span className="text-label-12-mono text-gray-1000 bg-gray-alpha-100 border-gray-alpha-400 inline-flex h-6 items-center rounded-full border px-2">
                v{entry.data.version}
              </span>
            </div>
            <article className="flex max-w-2xl flex-col gap-4">
              <h2 className="text-heading-32 text-gray-1000 text-balance">
                <Link
                  className="transition-colors hover:text-gray-900"
                  href={entry.url}
                >
                  {entry.data.title}
                </Link>
              </h2>
              <p className="text-copy-16 text-gray-900">
                {entry.data.description}
              </p>
              <Link
                className="text-label-14 text-gray-1000 inline-flex items-center gap-1 font-medium hover:underline hover:underline-offset-4"
                href={entry.url}
              >
                Read more
                <ArrowUpRightIcon aria-hidden className="size-4" />
              </Link>
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default Changelog;
