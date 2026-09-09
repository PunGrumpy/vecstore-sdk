"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ProviderIcon } from "@/components/provider-icon";
import type { ProviderId } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

export interface DemoProvider {
  readonly id: ProviderId;
  readonly label: string;
}

export interface DemoExample {
  readonly id: string;
  readonly label: string;
  readonly expression: string;
  readonly code: Readonly<Record<string, ReactNode>>;
  readonly output: Readonly<Record<string, string>>;
}

interface HeroDemoProps {
  readonly providers: readonly DemoProvider[];
  readonly examples: readonly DemoExample[];
}

const pillButton =
  "relative whitespace-nowrap rounded-md px-4 py-2 text-center font-medium text-[13px] transition-colors";

const trafficLights = ["bg-[#EE6D5E]", "bg-[#F3BF4A]", "bg-[#5DC753]"];

const bubbleEnter =
  "fade-in slide-in-from-bottom-2 animate-in duration-500 ease-out";

const BubbleTail = () => (
  <svg
    aria-hidden
    className="fill-gray-1000 absolute right-[2.5px] -bottom-[0.5px] z-10 translate-x-1/2 dark:fill-white"
    height="14"
    viewBox="0 0 18 14"
    width="18"
  >
    <path d="M0.87 8.8L11.26 0.8C11.26 0.8 12.06 9.5 17.26 13.2C12.06 13.2 0.87 8.8 0.87 8.8Z" />
  </svg>
);

export const HeroDemo = ({ providers, examples }: HeroDemoProps) => {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabRefs.current[exampleIndex];
      if (tab) {
        setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (listRef.current) {
      observer.observe(listRef.current);
    }
    return () => observer.disconnect();
  }, [exampleIndex]);
  const example = examples[exampleIndex] ?? examples[0];
  const provider = providers[providerIndex] ?? providers[0];

  if (!(example && provider)) {
    return null;
  }

  const step = (delta: number) =>
    setProviderIndex(
      (current) => (current + delta + providers.length) % providers.length
    );

  const selectProvider = (id: string) => {
    const index = providers.findIndex((item) => item.id === id);
    if (index !== -1) {
      setProviderIndex(index);
    }
  };

  const stateKey = `${example.id}-${provider.id}`;

  return (
    <div className="mx-auto mt-20 flex w-full max-w-4xl flex-col gap-4">
      <div className="mx-auto flex w-fit items-center justify-center gap-8">
        <div
          aria-label="Filter examples"
          className="relative mx-auto flex flex-wrap items-center justify-center gap-1"
          ref={listRef}
          role="tablist"
        >
          <span
            aria-hidden
            className="bg-background-100 absolute top-0 bottom-0 left-0 rounded-md border border-gray-400 shadow-sm transition-[transform,width] duration-300 ease-out"
            style={{
              transform: `translateX(${indicator.left}px)`,
              width: indicator.width,
            }}
          />
          {examples.map((item, index) => {
            const active = index === exampleIndex;
            return (
              <button
                aria-selected={active}
                className={cn(
                  pillButton,
                  active
                    ? "text-gray-1000"
                    : "hover:text-gray-1000 text-gray-900"
                )}
                key={item.id}
                onClick={() => setExampleIndex(index)}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                role="tab"
                type="button"
              >
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 max-md:hidden">
          <button
            aria-label="Previous provider"
            className="hover:text-gray-1000 p-1.5 text-gray-900 transition-colors"
            onClick={() => step(-1)}
            type="button"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </button>
          <button
            aria-label={`${provider.label}. Switch to next provider`}
            className="bg-background-100 text-gray-1000 flex size-10 items-center justify-center overflow-hidden rounded-full border border-gray-400 shadow-sm"
            onClick={() => step(1)}
            type="button"
          >
            <span
              className="fade-in zoom-in-50 animate-in flex items-center justify-center duration-200"
              key={provider.id}
            >
              <ProviderIcon className="size-4" id={provider.id} />
            </span>
          </button>
          <button
            aria-label="Next provider"
            className="hover:text-gray-1000 p-1.5 text-gray-900 transition-colors"
            onClick={() => step(1)}
            type="button"
          >
            <ChevronRightIcon aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      <div className="gap-4 md:grid md:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg shadow-sm">
          <div className="bg-background-100 relative flex h-12 items-center rounded-t-lg border border-b-0 border-gray-200 p-3">
            <div className="flex gap-1.5">
              {trafficLights.map((color) => (
                <span
                  className={cn("inline-block size-2 rounded-full", color)}
                  key={color}
                />
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-900">
              Compiled for
              <span className="relative inline-flex items-center">
                <select
                  className="bg-background-100 text-gray-1000 h-7 appearance-none rounded-md border border-gray-200 py-0 pr-7 pl-2 text-xs font-medium shadow-sm"
                  onChange={(event) => selectProvider(event.target.value)}
                  value={provider.id}
                >
                  {providers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon
                  aria-hidden
                  className="pointer-events-none absolute right-2 size-3.5 text-gray-900"
                />
              </span>
            </label>
          </div>
          <div className="bg-background-100 relative min-w-0 flex-1 overflow-hidden rounded-b-lg border border-gray-200">
            <div className="py-5 text-left">{example.code[provider.id]}</div>
            <div className="from-background-100 pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-lg bg-gradient-to-t to-transparent" />
          </div>
        </div>

        <div className="relative min-w-0 max-md:hidden">
          <div className="bg-background-100 flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 shadow-sm">
            <div className="flex flex-1 flex-col justify-start gap-4 p-6 text-left">
              <div
                className={cn("relative self-end", bubbleEnter)}
                key={`ask-${stateKey}`}
              >
                <div className="bg-gray-1000 max-w-[240px] rounded-xl px-3 py-2 font-mono text-[12px] leading-snug break-words text-gray-100 dark:bg-white dark:text-black">
                  {example.expression}
                </div>
                <BubbleTail />
              </div>
              <div
                className={cn("relative self-start", bubbleEnter)}
                key={`answer-${stateKey}`}
              >
                <pre className="bg-background-100 max-w-[260px] rounded-xl rounded-bl-sm border border-gray-200 px-3 py-2 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap text-gray-900">
                  {example.output[provider.id]}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 md:hidden">
        {providers.map((item, index) => (
          <button
            aria-label={item.label}
            className={cn(
              "text-gray-1000 relative rounded-full p-3 transition-colors",
              index === providerIndex
                ? "bg-background-100 border border-gray-200 shadow-sm"
                : "text-gray-900"
            )}
            key={item.id}
            onClick={() => setProviderIndex(index)}
            type="button"
          >
            <ProviderIcon className="size-4" id={item.id} />
          </button>
        ))}
      </div>
    </div>
  );
};
