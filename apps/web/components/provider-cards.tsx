import type { LucideIcon } from "lucide-react";
import {
  DatabaseIcon,
  FilterXIcon,
  FingerprintIcon,
  LayersIcon,
  RulerIcon,
  ServerIcon,
} from "lucide-react";
import Link from "next/link";

import { ProviderIcon } from "@/components/provider-icon";
import type { ProviderId } from "@/lib/landing-content";
import { cn } from "@/lib/utils";

interface Capability {
  readonly icon: LucideIcon;
  readonly label: string;
}

interface ProviderCard {
  readonly id: ProviderId;
  readonly name: string;
  readonly href: string;
  readonly glow: string;
  readonly logoClass: string;
  readonly capabilities: readonly Capability[];
}

const providers: readonly ProviderCard[] = [
  {
    capabilities: [
      { icon: LayersIcon, label: "Emulated namespaces" },
      { icon: FingerprintIcon, label: "Ids hashed to UUID" },
      { icon: FilterXIcon, label: "Delete by filter" },
      { icon: DatabaseIcon, label: "Index = collection" },
    ],
    glow: "#dc244c",
    href: "/docs/providers/qdrant",
    id: "qdrant",
    logoClass: "text-[#dc244c]",
    name: "Qdrant",
  },
  {
    capabilities: [
      { icon: LayersIcon, label: "Emulated namespaces" },
      { icon: RulerIcon, label: "Metric read from index" },
      { icon: FilterXIcon, label: "Delete by filter" },
      { icon: DatabaseIcon, label: "Index = table" },
    ],
    glow: "#4169e1",
    href: "/docs/providers/pgvector",
    id: "pgvector",
    logoClass: "text-[#4169e1]",
    name: "pgvector",
  },
  {
    capabilities: [
      { icon: LayersIcon, label: "Native namespaces" },
      { icon: ServerIcon, label: "Serverless index spec" },
      { icon: DatabaseIcon, label: "Index = index" },
    ],
    glow: "#8f8f8f",
    href: "/docs/providers/pinecone",
    id: "pinecone",
    logoClass: "text-[#201d1e] dark:text-white",
    name: "Pinecone",
  },
];

const Glow = ({
  color,
  id,
}: {
  readonly color: string;
  readonly id: string;
}) => (
  <svg
    aria-hidden
    className="pointer-events-none absolute top-0 left-0 size-full"
    preserveAspectRatio="none"
    viewBox="0 0 100 100"
  >
    <defs>
      <radialGradient id={`${id}-glow`}>
        <stop offset="0%" stopColor={color} stopOpacity="0.1" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="50" cy="0" fill={`url(#${id}-glow)`} rx="54" ry="20" />
  </svg>
);

export const ProviderCards = () => (
  <div className="not-prose grid gap-4 md:grid-cols-2">
    {providers.map((provider) => (
      <Link className="size-full" href={provider.href} key={provider.id}>
        <div className="bg-background-100 relative flex size-full flex-col justify-between overflow-hidden rounded-lg border border-gray-200 p-4 shadow-sm transition-[border-color,box-shadow] hover:border-gray-400 hover:shadow-lg">
          <p className="text-gray-1000 text-lg leading-tight font-semibold tracking-tight">
            {provider.name}
          </p>
          <div className="z-10 flex flex-1 items-center justify-center">
            <div className="text-gray-1000 flex min-h-36 items-center justify-center">
              <ProviderIcon
                className={cn("size-19.5", provider.logoClass)}
                id={provider.id}
              />
            </div>
          </div>
          <Glow color={provider.glow} id={provider.id} />
          <div className="mt-2 flex w-full flex-row flex-wrap gap-2">
            {provider.capabilities.map((capability) => (
              <span
                className="bg-gray-alpha-100 text-gray-1000 inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] leading-4 font-medium"
                key={capability.label}
              >
                <capability.icon
                  aria-hidden
                  className="size-3.5 text-gray-900"
                />
                {capability.label}
              </span>
            ))}
          </div>
        </div>
      </Link>
    ))}
  </div>
);
