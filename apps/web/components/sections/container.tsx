import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Container = ({
  children,
  className,
  ...props
}: ComponentProps<"section">) => (
  <section
    className={cn("mx-auto w-full max-w-[1120px] px-6", className)}
    {...props}
  >
    {children}
  </section>
);
