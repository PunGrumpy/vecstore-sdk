import { readFile } from "node:fs/promises";
import path from "node:path";

import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";

import { providerIds } from "@/lib/landing-content";
import { getPageImage, source } from "@/lib/source";

export const dynamicParams = false;
export const revalidate = false;

const WIDTH = 1200;
const HEIGHT = 630;
const TEXT_WIDTH = 580;
const DESCRIPTION_LIMIT = 104;
const TEXT_TOP = 408;

const assets = path.join(process.cwd(), "..", "..", "assets");
const backgrounds = path.join(process.cwd(), "app", "og", "docs", "[...slug]");

const readFont = (file: string) => readFile(path.join(assets, "fonts", file));

const readBackground = async (slugs: readonly string[]) => {
  const [group, name] = slugs;
  const provider =
    group === "providers" && providerIds.some((id) => id === name)
      ? name
      : undefined;
  const file = provider ? `background-${provider}.png` : "background.png";
  const data = await readFile(path.join(backgrounds, file));

  return data.toString("base64");
};

const clamp = (text: string) => {
  if (text.length <= DESCRIPTION_LIMIT) {
    return text;
  }

  return `${text.slice(0, text.lastIndexOf(" ", DESCRIPTION_LIMIT))}…`;
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

  const [background, regular, semibold] = await Promise.all([
    readBackground(page.slugs),
    readFont("Geist-Regular.ttf"),
    readFont("Geist-SemiBold.ttf"),
  ]);
  const { description, title } = page.data;

  return new ImageResponse(
    <div
      style={{
        backgroundColor: "#000000",
        backgroundImage: `url("data:image/png;base64,${background}")`,
        backgroundSize: `${WIDTH}px ${HEIGHT}px`,
        display: "flex",
        flexDirection: "column",
        fontFamily: "Geist",
        height: "100%",
        padding: `${TEXT_TOP}px 80px 0`,
        width: "100%",
      }}
    >
      <div
        style={{
          color: "#ededed",
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          maxWidth: TEXT_WIDTH,
          textWrap: "balance",
        }}
      >
        {title}
      </div>
      {description ? (
        <div
          style={{
            color: "#8f8f8f",
            fontSize: 26,
            lineHeight: 1.45,
            marginTop: 20,
            maxWidth: TEXT_WIDTH,
          }}
        >
          {clamp(description)}
        </div>
      ) : null}
    </div>,
    {
      fonts: [
        { data: regular, name: "Geist", weight: 400 },
        { data: semibold, name: "Geist", weight: 600 },
      ],
      height: HEIGHT,
      width: WIDTH,
    }
  );
};

export const generateStaticParams = () =>
  source.getPages().map((page) => ({ slug: getPageImage(page).segments }));

export { handler as GET };
