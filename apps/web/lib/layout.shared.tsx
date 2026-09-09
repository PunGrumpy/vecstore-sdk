import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "@/components/logo";

export const githubUrl = "https://github.com/PunGrumpy/vecstore-sdk";

export const baseOptions = (): BaseLayoutProps => ({
  githubUrl,
  links: [
    {
      active: "nested-url",
      text: "Docs",
      url: "/docs",
    },
  ],
  nav: {
    title: <Logo />,
    url: "/",
  },
  themeSwitch: { enabled: false },
});
