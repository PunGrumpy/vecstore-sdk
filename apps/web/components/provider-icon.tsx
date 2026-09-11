import type { ComponentProps } from "react";

import { PgvectorIcon } from "@/components/icons/pgvector";
import { PineconeIcon } from "@/components/icons/pinecone";
import { QdrantIcon } from "@/components/icons/qdrant";
import { RedisIcon } from "@/components/icons/redis";
import { SupabaseIcon } from "@/components/icons/supabase";
import { UpstashIcon } from "@/components/icons/upstash";
import { VectorizeIcon } from "@/components/icons/vectorize";
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
    case "supabase": {
      return <SupabaseIcon {...props} />;
    }
    case "upstash": {
      return <UpstashIcon {...props} />;
    }
    case "vectorize": {
      return <VectorizeIcon {...props} />;
    }
    case "redis": {
      return <RedisIcon {...props} />;
    }
    default: {
      return <PineconeIcon {...props} />;
    }
  }
};
