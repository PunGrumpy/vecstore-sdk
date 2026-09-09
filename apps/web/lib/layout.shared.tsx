import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Link from "next/link";

import { GithubIcon } from "@/components/icons/github";
import { Logo } from "@/components/logo";

export const githubUrl = "https://github.com/PunGrumpy/vecstore-sdk";

export const baseOptions = (): BaseLayoutProps => ({
  githubUrl,
  links: [],
  nav: {
    children: (
      <div className="flex flex-1 items-center">
        <Link
          className="text-fd-muted-foreground hover:text-fd-accent-foreground ms-6 inline-flex items-center p-2 text-sm transition-colors"
          href="/docs"
        >
          Docs
        </Link>
        <a
          aria-label="GitHub"
          className="text-fd-muted-foreground hover:text-fd-accent-foreground ms-auto inline-flex items-center p-2 transition-colors lg:hidden"
          href={githubUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          <GithubIcon className="size-5" />
        </a>
      </div>
    ),
    title: <Logo />,
    url: "/",
  },
  themeSwitch: { enabled: false },
});
