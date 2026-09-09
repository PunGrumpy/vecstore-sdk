import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { CopyCommand } from "@/components/landing/copy-command";
import { Demo } from "@/components/landing/demo";
import { VectorField } from "@/components/landing/vector-field";
import { installCommand } from "@/lib/landing-content";

export const Hero = () => (
  <div className="relative isolate mx-auto flex w-full flex-col items-center px-6 pt-32 pb-16 text-center">
    <VectorField />
    <h1 className="max-w-4xl text-[40px] leading-[1.05] font-semibold tracking-[-0.04em] text-balance md:text-[64px]">
      One filter language for every vector store
    </h1>
    <p className="text-copy-20 mt-8 max-w-2xl text-balance text-gray-900">
      A unified TypeScript SDK for Qdrant, pgvector, and Pinecone. Write one
      metadata filter and each adapter compiles it to the provider&apos;s native
      syntax.
    </p>
    <CopyCommand className="mt-10" command={installCommand} />
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
