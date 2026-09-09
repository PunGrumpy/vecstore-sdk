import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { Footer } from "@/components/landing/footer";
import { baseOptions } from "@/lib/layout.shared";

interface HomeRouteLayoutProps {
  readonly children: ReactNode;
}

const HomeRouteLayout = ({ children }: HomeRouteLayoutProps) => (
  <HomeLayout {...baseOptions()}>
    {children}
    <Footer />
  </HomeLayout>
);

export default HomeRouteLayout;
