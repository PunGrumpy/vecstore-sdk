import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";

import { providerIds } from "@/lib/landing-content";
import { getPageImage, source } from "@/lib/source";

export const dynamicParams = false;
export const revalidate = false;

const backgrounds = path.join(process.cwd(), "app", "og", "docs", "[...slug]");

const readBackground = (slugs: readonly string[]) => {
  const [group, name] = slugs;
  const provider =
    group === "providers" && providerIds.some((id) => id === name)
      ? name
      : undefined;
  const file = provider ? `background-${provider}.png` : "background.png";

  return readFile(path.join(backgrounds, file));
};

const handler = async (
  _request: Request,
  { params }: RouteContext<"/og/docs/[...slug]">
) => {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));

  if (!page) {
    notFound();
  }

  const background = await readBackground(page.slugs);

  return new Response(new Uint8Array(background), {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/png",
    },
  });
};

export const generateStaticParams = () =>
  source.getPages().map((page) => ({ slug: getPageImage(page).segments }));

export { handler as GET };
