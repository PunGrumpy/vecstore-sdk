import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import Link from "next/link";
import type { ReactNode } from "react";

import { Folder, Item, Separator } from "@/components/docs/sidebar-items";
import { VersionCard } from "@/components/docs/version-card";
import { Footer } from "@/components/landing/footer";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

interface DocsRouteLayoutProps {
  readonly children: ReactNode;
}

const DocsRouteLayout = ({ children }: DocsRouteLayoutProps) => {
  const { nav, ...options } = baseOptions();

  return (
    <>
      <DocsLayout
        {...options}
        links={[]}
        nav={{
          ...nav,
          children: (
            <Link
              className="text-fd-primary ml-6 inline-flex items-center gap-1 p-2 text-sm max-md:hidden"
              href="/docs"
            >
              Docs
            </Link>
          ),
          mode: "top",
        }}
        sidebar={{
          banner: <VersionCard />,
          collapsible: false,
          components: { Folder, Item, Separator },
        }}
        tree={source.getPageTree()}
      >
        {children}
      </DocsLayout>
      <div className="[--fd-layout-width:var(--site-width)]">
        <Footer />
      </div>
    </>
  );
};

export default DocsRouteLayout;
