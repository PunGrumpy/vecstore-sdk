import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { CopyCommand } from "@/components/landing/copy-command";
import { Demo } from "@/components/landing/demo";
import { StoreStack } from "@/components/landing/store/stack";
import { installCommand } from "@/lib/landing-content";

export const Hero = () => (
  <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center px-6 pt-20 pb-16">
    <div className="flex w-full flex-col items-center gap-10 text-center lg:flex-row lg:justify-between lg:gap-12 lg:text-left">
      <StoreStack className="size-64 shrink-0 md:size-80 lg:order-last lg:size-96" />
      <div className="flex max-w-xl min-w-0 flex-col items-center lg:items-start">
        <h1 className="text-heading-40 md:text-heading-56 text-balance">
          One filter language for every vector store
        </h1>
        <p className="text-copy-20 mt-6 text-balance text-gray-900">
          A unified TypeScript SDK for Qdrant, pgvector, and Pinecone. Write one
          metadata filter and each adapter compiles it to the provider’s native
          syntax.
        </p>
        <CopyCommand className="mt-8" command={installCommand} />
      </div>
    </div>
    <Demo />
    <p className="text-copy-14 mt-8 text-gray-900">
      See all{" "}
      <Link
        className="text-gray-1000 inline-flex items-center font-medium hover:underline hover:underline-offset-4"
        href="/docs"
      >
        supported providers
        <ArrowUpRightIcon aria-hidden className="size-4" />
      </Link>
    </p>
  </div>
);
