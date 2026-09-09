import type { ReactNode } from "react";

interface ContainerProps {
  readonly children: ReactNode;
}

export const Container = ({ children }: ContainerProps) => (
  <div className="mx-auto w-full max-w-[1120px] px-6">{children}</div>
);
