import type { InferPageType } from "fumadocs-core/source";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";

import { changelog as entries } from "@/.source/server";

export const changelog = loader({
  baseUrl: "/changelog",
  source: toFumadocsSource(entries, []),
});

export type ChangelogEntry = InferPageType<typeof changelog>;

export const getChangelogEntries = (): ChangelogEntry[] =>
  changelog
    .getPages()
    .toSorted((a, b) => b.data.date.getTime() - a.data.date.getTime());

const dateFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export const formatChangelogDate = (date: Date): string =>
  dateFormat.format(date);
