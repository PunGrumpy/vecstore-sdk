import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  PageBreadcrumb,
} from "fumadocs-ui/layouts/notebook/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getMDXComponents } from "@/components/mdx";
import { getPageImage, source } from "@/lib/source";

type DocsPageProps = PageProps<"/docs/[[...slug]]">;

const Page = async ({ params }: DocsPageProps) => {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const Body = page.data.body;
  const markdownUrl = `/llms.mdx${page.url}`;

  return (
    <DocsPage
      breadcrumb={{ enabled: false }}
      full={page.data.full}
      tableOfContent={{ style: "normal" }}
      toc={page.data.toc}
    >
      <div className="flex items-center justify-between gap-4">
        <PageBreadcrumb includePage includeRoot={{ url: "/docs" }} />
        <MarkdownCopyButton markdownUrl={markdownUrl} />
      </div>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Body
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () => source.generateParams();

export const generateMetadata = async ({
  params,
}: DocsPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const image = getPageImage(page).url;

  return {
    description: page.data.description,
    openGraph: {
      description: page.data.description,
      images: image,
      siteName: "VecStore SDK",
      type: "article",
      url: page.url,
    },
    title: page.data.title,
    twitter: {
      card: "summary_large_image",
      description: page.data.description,
      images: image,
    },
  };
};

export default Page;
