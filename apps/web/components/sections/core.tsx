import Link from "next/link";

import { Code } from "@/components/landing/code";
import { Container } from "@/components/sections/container";
import { switchCode, verbs } from "@/lib/landing-content";

export const Core = () => (
  <Container>
    <div className="bg-background-100 mt-4 grid grid-cols-1 overflow-hidden rounded-lg border border-gray-200 shadow-sm lg:grid-cols-[1fr_2fr]">
      <div className="flex flex-col p-8 lg:p-12">
        <h2 className="text-heading-24 text-gray-1000">VecStore Core</h2>
        <p className="text-copy-16 mt-3 text-gray-900">
          Four record verbs, three index verbs, and a filter AST with twelve
          builders. The same signatures on every provider.
        </p>
        <h2 className="text-heading-24 text-gray-1000 mt-10">Adapters</h2>
        <p className="text-copy-16 mt-3 text-gray-900">
          Thin wrappers over the native client you already use. The raw client
          stays one property away.
        </p>
        <Link
          className="text-button-14 bg-gray-1000 text-background-100 mt-10 inline-flex h-[42px] items-center justify-center self-start rounded-full px-4 transition-colors hover:bg-gray-900"
          href="/docs"
        >
          Read the docs
        </Link>
      </div>
      <div className="flex min-w-0 flex-col border-t border-gray-200 lg:border-t-0 lg:border-l">
        <div className="min-w-0 p-6">
          <Code code={switchCode} lang="ts" title="switch-provider.ts" />
        </div>
        <ul className="grid grid-cols-2 border-t border-gray-200 md:grid-cols-4">
          {verbs.map((verb) => (
            <li
              className="text-label-13-mono border-r border-b border-gray-200 px-6 py-4 text-gray-900 nth-[4n]:border-r-0 nth-last-[-n+4]:border-b-0"
              key={verb}
            >
              {verb}()
            </li>
          ))}
        </ul>
      </div>
    </div>
  </Container>
);
