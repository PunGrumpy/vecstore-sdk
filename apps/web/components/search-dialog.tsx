"use client";

import { useDocsSearch } from "fumadocs-core/search/client";
import { fetchClient } from "fumadocs-core/search/client/fetch";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/components/dialog/search";
import Link from "next/link";

const suggestions = [
  {
    description: "Install the package and run your first filtered query.",
    title: "Getting started",
    url: "/docs/getting-started",
  },
  {
    description: "Every builder and what it compiles to on each provider.",
    title: "Filters",
    url: "/docs/core/filters",
  },
  {
    description: "The seven error kinds and how to match on them.",
    title: "Errors",
    url: "/docs/core/errors",
  },
  {
    description: "The two filter cases where providers disagree.",
    title: "Provider differences",
    url: "/docs/providers/differences",
  },
  {
    description: "What changes when you swap the adapter.",
    title: "Move between providers",
    url: "/docs/guides/migration",
  },
] as const;

const Suggestions = ({ onNavigate }: { readonly onNavigate: () => void }) => (
  <div className="flex flex-col gap-4 p-4">
    {suggestions.map((page) => (
      <Link
        className="text-gray-1000 flex flex-col gap-1.5 rounded-lg border border-gray-200 p-2 pb-0 transition-colors hover:bg-gray-100"
        href={page.url}
        key={page.url}
        onClick={onNavigate}
      >
        <span className="truncate text-sm font-medium">{page.title}</span>
        <span className="mb-2 text-sm text-gray-900">{page.description}</span>
      </Link>
    ))}
  </div>
);

export const SiteSearchDialog = (props: SharedProps) => {
  const { search, setSearch, query } = useDocsSearch({
    client: fetchClient({ api: "/api/search" }),
  });
  const results = query.data === "empty" ? null : query.data;

  return (
    <SearchDialog
      isLoading={query.isLoading}
      onSearchChange={setSearch}
      search={search}
      {...props}
    >
      <SearchDialogOverlay className="bg-black/50 data-[state=closed]:animate-none data-[state=open]:animate-none" />
      <SearchDialogContent className="bg-background-100 w-[calc(100%-1rem)] max-w-[650px] rounded-xl border border-gray-200 shadow-xl data-[state=closed]:animate-none data-[state=open]:animate-none">
        <SearchDialogHeader className="flex items-center gap-4 border-b border-gray-200 p-4">
          <SearchDialogIcon className="size-[18px] text-gray-800" />
          <SearchDialogInput
            className="text-gray-1000 w-full bg-transparent text-base placeholder:text-gray-800"
            placeholder="What are you searching for?"
          />
          <SearchDialogClose className="rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-sm text-gray-900">
            Esc
          </SearchDialogClose>
        </SearchDialogHeader>
        {results ? (
          <SearchDialogList items={results} />
        ) : (
          <Suggestions onNavigate={() => props.onOpenChange(false)} />
        )}
      </SearchDialogContent>
    </SearchDialog>
  );
};
