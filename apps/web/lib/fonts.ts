import {
  Geist as createSans,
  Geist_Mono as createMono,
} from "next/font/google";

import { cn } from "./utils";

const sans = createSans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-sans",
  weight: "variable",
});

const mono = createMono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: "variable",
});

export const fonts = cn(
  "touch-manipulation font-sans antialiased [font-synthesis-weight:none]",
  sans.variable,
  mono.variable
);
