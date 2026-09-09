"use client";

import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface CopyCommandProps {
  readonly command: string;
  readonly className?: string;
  readonly pill?: boolean;
}

export const CopyCommand = ({
  command,
  className,
  pill = false,
}: CopyCommandProps) => {
  const [copied, onCopy] = useCopyButton(() =>
    navigator.clipboard.writeText(command)
  );
  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <button
      aria-label={`Copy ${command}`}
      className={cn(
        "text-gray-1000 inline-flex min-w-0 items-center gap-3 text-left font-mono text-[14px] leading-5 whitespace-nowrap transition-colors",
        pill
          ? "bg-background-100 h-[42px] rounded-full border border-gray-200 pr-1 pl-4 shadow-sm hover:bg-gray-100"
          : "material-base h-12 px-4 hover:bg-gray-100",
        className
      )}
      onClick={onCopy}
      type="button"
    >
      <span aria-hidden className="shrink-0 text-gray-700">
        $
      </span>
      <span className="min-w-0 flex-1 truncate">{command}</span>
      {pill ? (
        <span className="bg-background-100 text-gray-1000 flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-200 shadow-sm">
          <Icon aria-hidden className="size-4" />
        </span>
      ) : (
        <Icon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            copied ? "text-green-800" : "text-gray-800"
          )}
        />
      )}
    </button>
  );
};
