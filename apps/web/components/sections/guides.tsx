import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { CopyCommand } from "@/components/landing/copy-command";
import { Container } from "@/components/sections/container";
import { guides, installCommand } from "@/lib/landing-content";

export const Guides = () => (
  <Container>
    <div className="flex flex-col gap-6 pb-8 md:flex-row md:items-start md:justify-between">
      <div>
        <h2 className="text-heading-40 text-gray-1000">
          Build with VecStore
          <span className="mx-[0.2em] inline-flex translate-y-[-0.08em] items-center rounded-full border-[0.06em] border-current px-[0.35em] align-middle text-[0.5em] leading-[1.5] font-semibold tracking-[0.02em]">
            SDK
          </span>
          today
        </h2>
        <p className="text-copy-16 mt-3 max-w-md text-gray-900">
          Get started with the docs, or open the repository and read the design
          notes.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Link
          className="bg-gray-1000 text-background-100 inline-flex h-[42px] items-center justify-center rounded-full px-4 text-[14px] font-medium transition-colors hover:bg-gray-900"
          href="/docs"
        >
          Visit documentation
        </Link>
        <CopyCommand command={installCommand} pill />
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 pb-24 md:grid-cols-3">
      {guides.map((guide) => (
        <Link
          className="bg-background-100 group flex flex-col gap-3 rounded-lg border border-gray-200 p-8 shadow-sm transition-colors hover:bg-gray-100"
          href={guide.href}
          key={guide.title}
        >
          <h3 className="text-heading-20 text-gray-1000 inline-flex items-center gap-1">
            {guide.title}
            <ArrowUpRightIcon
              aria-hidden
              className="group-hover:text-gray-1000 size-4 text-gray-700 transition-colors"
            />
          </h3>
          <p className="text-copy-16 text-gray-900">{guide.body}</p>
        </Link>
      ))}
    </div>
  </Container>
);
