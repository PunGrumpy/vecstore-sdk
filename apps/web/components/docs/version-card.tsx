import { TagIcon } from "lucide-react";

import { githubUrl } from "@/lib/layout.shared";

import { version } from "../../../../packages/vecstore-sdk/package.json";

const major = version.split(".")[0] ?? "0";

export const VersionCard = () => (
  <a
    target="_blank"
    rel="noopener noreferrer"
    className="grid h-15 w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md p-2 transition-colors hover:bg-gray-100"
    href={`${githubUrl}/releases`}
  >
    <span className="flex size-8 items-center justify-center rounded-md border border-amber-400 bg-amber-100 text-amber-900">
      <TagIcon aria-hidden className="size-4" />
    </span>
    <span className="text-left">
      <span className="text-gray-1000 block text-[14px] leading-5 font-medium">
        v{major} (Latest)
      </span>
      <span className="block text-[12px] leading-4 text-gray-900">
        vecstore-sdk {version}
      </span>
    </span>
  </a>
);
