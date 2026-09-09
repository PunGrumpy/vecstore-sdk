import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { Code } from "@/components/landing/code";
import { CopyCommand } from "@/components/landing/copy-command";
import { Demo } from "@/components/landing/demo";
import { ProviderMark } from "@/components/landing/provider-marks";
import { ProviderIcon } from "@/components/provider-icon";
import {
  adapters,
  demoProviders,
  guides,
  highlights,
  installCommand,
  stats,
  switchCode,
  verbs,
} from "@/lib/landing-content";

const card = "rounded-lg border border-gray-200 bg-background-100 shadow-sm";

const pillButton =
  "inline-flex h-[42px] items-center justify-center rounded-full bg-gray-1000 px-4 font-medium text-[14px] text-background-100 transition-colors hover:bg-gray-900";

const primaryButton =
  "text-button-14 inline-flex h-8 items-center justify-center rounded-md bg-gray-1000 px-3 text-background-100 transition-colors hover:bg-gray-900";

const Container = ({ children }: { readonly children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-[1120px] px-6">{children}</div>
);

const Hero = () => (
  <div className="mx-auto flex w-full max-w-[1120px] flex-col items-center px-6 pt-32 pb-16 text-center">
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

const Stats = () => (
  <Container>
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <div className={`${card} p-6`} key={stat.label}>
          <dd className="text-heading-32 text-gray-1000">{stat.value}</dd>
          <dt className="text-label-13-mono mt-2 text-gray-900">
            {stat.label}
          </dt>
        </div>
      ))}
    </dl>
  </Container>
);

const Pitch = () => (
  <Container>
    <div className="flex flex-col items-center py-24 text-center">
      <h2 className="text-heading-40 max-w-3xl text-balance">
        The provider-agnostic vector toolkit
      </h2>
      <p className="text-copy-18 mt-6 max-w-2xl text-balance text-gray-900">
        Vector databases agree on the verbs and disagree on everything else.
        VecStore SDK keeps the verbs and hides the rest, so switching providers
        changes one import and one config object.
      </p>
      <ul className="mt-12 flex flex-wrap items-center justify-center gap-10">
        {demoProviders.map((provider) => (
          <li
            className="hover:text-gray-1000 text-gray-800 transition-colors"
            key={provider.id}
            title={provider.label}
          >
            <ProviderMark className="size-14" id={provider.id} />
            <span className="sr-only">{provider.label}</span>
          </li>
        ))}
      </ul>
    </div>
  </Container>
);

const Highlights = () => (
  <Container>
    <div className="grid gap-4 md:grid-cols-3">
      {highlights.map((item) => (
        <div className={`${card} p-8`} key={item.title}>
          <h3 className="text-heading-20 text-gray-1000">{item.title}</h3>
          <p className="text-copy-16 mt-2 text-gray-900">{item.body}</p>
        </div>
      ))}
    </div>
  </Container>
);

const Core = () => (
  <Container>
    <div className={`${card} mt-4 grid overflow-hidden lg:grid-cols-[1fr_2fr]`}>
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
        <Link className={`${primaryButton} mt-10 self-start`} href="/docs">
          Read the docs
        </Link>
      </div>
      <div className="flex flex-col border-t border-gray-200 lg:border-t-0 lg:border-l">
        <div className="p-6">
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

const Adapters = () => (
  <Container>
    <div className="grid gap-4 py-24 lg:grid-cols-[1fr_2fr]">
      <div className="lg:pr-12">
        <h2 className="text-heading-32 text-gray-1000">
          Bring your own client
        </h2>
        <p className="text-copy-16 mt-4 text-gray-900">
          Provider SDKs are optional peer dependencies. Install only the one you
          use and the adapter imports nothing else.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {adapters.map((adapter) => (
          <div
            className={`${card} flex flex-col gap-4 p-8`}
            key={adapter.title}
          >
            <h3 className="text-gray-1000 flex items-center gap-2 font-mono text-[16px] leading-5">
              {adapter.mark ? (
                <ProviderIcon className="size-4" id={adapter.mark} />
              ) : null}
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

const Guides = () => (
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
        <Link className={pillButton} href="/docs">
          Visit documentation
        </Link>
        <CopyCommand command={installCommand} pill />
      </div>
    </div>
    <div className="grid gap-4 pb-24 md:grid-cols-3">
      {guides.map((guide) => (
        <Link
          className={`${card} group flex flex-col gap-3 p-8 transition-colors hover:bg-gray-100`}
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

const Home = () => (
  <>
    <Hero />
    <Stats />
    <Pitch />
    <Highlights />
    <Core />
    <Adapters />
    <Guides />
  </>
);

export default Home;
