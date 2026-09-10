import "./globals.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteSearchDialog } from "@/components/search-dialog";
import { fonts } from "@/lib/fonts";

export const metadata: Metadata = {
  description:
    "A unified vector store SDK for TypeScript. One filter language across Qdrant, pgvector, Pinecone, and Upstash Vector, so you can switch providers without rewriting queries.",
  title: {
    default: "VecStore SDK",
    template: "%s | VecStore SDK",
  },
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

const RootLayout = ({ children }: RootLayoutProps) => (
  <html
    lang="en"
    className={fonts}
    data-scroll-behavior="smooth"
    suppressHydrationWarning
  >
    <body>
      <a
        className="bg-background-100 text-gray-1000 fixed top-3 left-3 z-50 -translate-y-[200%] rounded-md px-3 py-2 text-sm shadow-sm focus-visible:translate-y-0"
        href="#nd-page"
      >
        Skip to content
      </a>
      <RootProvider search={{ SearchDialog: SiteSearchDialog }}>
        {children}
      </RootProvider>
    </body>
  </html>
);

export default RootLayout;
