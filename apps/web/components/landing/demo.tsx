import { highlight } from "fumadocs-core/highlight";
import type { ComponentProps } from "react";

import { HeroDemo } from "@/components/landing/hero-demo";
import { demoExamples, demoProviders } from "@/lib/landing-content";
import { geistShikiTheme } from "@/lib/shiki-theme";
import { cn } from "@/lib/utils";

const MAX_LINE = 64;
const ELLIPSIS = "...";

const DemoPre = ({ className, style, ...props }: ComponentProps<"pre">) => (
  <pre
    className={cn(
      className,
      "min-w-0 overflow-hidden text-[13px] leading-5 [--padding-left:1.5rem]"
    )}
    data-line-numbers
    style={{ ...style, background: "transparent", counterReset: "line" }}
    {...props}
  />
);

const clampLines = (code: string) =>
  code
    .split("\n")
    .map((line) =>
      line.length > MAX_LINE
        ? `${line.slice(0, MAX_LINE - ELLIPSIS.length)}${ELLIPSIS}`
        : line
    )
    .join("\n");

const renderCode = (code: string) =>
  highlight(clampLines(code), {
    components: { pre: DemoPre },
    lang: "ts",
    themes: { dark: geistShikiTheme, light: geistShikiTheme },
  });

export const Demo = async () => {
  const examples = await Promise.all(
    demoExamples.map(async (example) => {
      const entries = await Promise.all(
        demoProviders.map(async (provider) => [
          provider.id,
          await renderCode(provider.snippet(example.filterCode)),
        ])
      );
      return {
        code: Object.fromEntries(entries),
        expression: example.expression,
        id: example.id,
        label: example.label,
        output: example.output,
      };
    })
  );
  const providers = demoProviders.map(({ id, label }) => ({ id, label }));

  return <HeroDemo examples={examples} providers={providers} />;
};
