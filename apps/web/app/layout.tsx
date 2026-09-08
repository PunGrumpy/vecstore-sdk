import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { fonts } from "@/lib/fonts";

export const metadata: Metadata = {
  description:
    "A unified vector store SDK for TypeScript. One filter language across Qdrant, pgvector, and Pinecone, so you can switch providers without rewriting queries.",
  title: "Vector SDK",
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
    <body>{children}</body>
  </html>
);

export default RootLayout;
