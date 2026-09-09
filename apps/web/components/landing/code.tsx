import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";

interface CodeProps {
  readonly code: string;
  readonly lang: "ts" | "json" | "sql";
  readonly title?: string;
}

export const Code = ({ code, lang, title }: CodeProps) => (
  <ServerCodeBlock
    code={code}
    codeblock={{ className: "my-0 h-full", title }}
    lang={lang}
  />
);
