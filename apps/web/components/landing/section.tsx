import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Section = ({ className, ...props }: ComponentProps<"section">) => (
  <section
    className={cn("border-gray-alpha-400 border-t", className)}
    {...props}
  />
);

export const Cell = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("p-12", className)} {...props} />
);
