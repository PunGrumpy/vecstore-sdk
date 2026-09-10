import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { CopyCommand } from "@/components/landing/copy-command";
import { ProviderIcon } from "@/components/provider-icon";
import { Container } from "@/components/sections/container";
import { adapters } from "@/lib/landing-content";

export const Adapters = () => (
  <Container>
    <div className="grid grid-cols-1 gap-4 py-24 lg:grid-cols-[1fr_2fr]">
      <div className="lg:pr-12">
        <h2 className="text-heading-32 text-gray-1000">
          Bring your own client
        </h2>
        <p className="text-copy-16 mt-4 text-gray-900">
          Provider SDKs are optional peer dependencies. Install only the one you
          use and the adapter imports nothing else.
        </p>
        <Link
          className="text-copy-16 text-gray-1000 group mt-4 inline-flex items-center gap-1"
          href="/docs/providers/differences"
        >
          See all six providers
          <ArrowUpRightIcon
            aria-hidden
            className="group-hover:text-gray-1000 size-4 text-gray-700 transition-colors"
          />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {adapters.map((adapter) => (
          <div
            className="bg-background-100 flex flex-col gap-4 rounded-lg border border-gray-200 p-8 shadow-sm"
            key={adapter.title}
          >
            <h3 className="text-gray-1000 flex items-center gap-2 font-mono text-[16px] leading-5">
              <ProviderIcon className="size-4" id={adapter.mark} />
              {adapter.title}
            </h3>
            <p className="text-copy-16 text-gray-900">{adapter.body}</p>
            <CopyCommand
              className="mt-auto h-11 w-full text-[12px]"
              command={adapter.command}
            />
          </div>
        ))}
      </div>
    </div>
  </Container>
);
