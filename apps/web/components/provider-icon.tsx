import type { ComponentProps } from "react";

import { PgvectorIcon } from "@/components/icons/pgvector";
import { PineconeIcon } from "@/components/icons/pinecone";
import { QdrantIcon } from "@/components/icons/qdrant";
import { UpstashIcon } from "@/components/icons/upstash";
import type { ProviderId } from "@/lib/landing-content";

interface ProviderIconProps extends ComponentProps<"svg"> {
  readonly id: ProviderId;
}

export const ProviderIcon = ({ id, ...props }: ProviderIconProps) => {
  switch (id) {
    case "qdrant": {
      return <QdrantIcon {...props} />;
    }
    case "pgvector": {
      return <PgvectorIcon {...props} />;
    }
    case "upstash": {
      return <UpstashIcon {...props} />;
    }
    default: {
      return <PineconeIcon {...props} />;
    }
  }
};
