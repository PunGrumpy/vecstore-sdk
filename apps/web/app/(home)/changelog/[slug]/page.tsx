import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getMDXComponents } from "@/components/mdx";
import { changelog, formatChangelogDate } from "@/lib/changelog";

type ChangelogEntryProps = PageProps<"/changelog/[slug]">;

const ChangelogEntry = async ({ params }: ChangelogEntryProps) => {
  const { slug } = await params;
  const entry = changelog.getPage([slug]);

  if (!entry) {
    notFound();
  }

  const Body = entry.data.body;

  return (
    <article className="mx-auto w-full max-w-[720px] px-6 pt-20 pb-24">
      <Link
        className="text-label-14 hover:text-gray-1000 inline-flex items-center gap-1 text-gray-900 transition-colors"
        href="/changelog"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Changelog
      </Link>
      <div className="mt-8 flex items-center gap-3">
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
      <h1 className="text-heading-40 text-gray-1000 mt-4 text-balance">
        {entry.data.title}
      </h1>
      <p className="text-copy-18 mt-4 text-gray-900">
        {entry.data.description}
      </p>
      <div className="prose mt-10">
        <Body components={getMDXComponents()} />
      </div>
    </article>
  );
};

export const generateStaticParams = () =>
  changelog.getPages().map((entry) => ({ slug: entry.slugs[0] }));

export const generateMetadata = async ({
  params,
}: ChangelogEntryProps): Promise<Metadata> => {
  const { slug } = await params;
  const entry = changelog.getPage([slug]);

  if (!entry) {
    notFound();
  }

  return {
    description: entry.data.description,
    openGraph: {
      description: entry.data.description,
      images: "/opengraph-image.png",
      publishedTime: entry.data.date.toISOString(),
      siteName: "VecStore SDK",
      type: "article",
      url: entry.url,
    },
    title: `${entry.data.title} | Changelog`,
    twitter: {
      card: "summary_large_image",
      description: entry.data.description,
      images: "/opengraph-image.png",
    },
  };
};

export default ChangelogEntry;
