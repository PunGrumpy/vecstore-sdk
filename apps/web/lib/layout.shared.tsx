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
          className="text-fd-muted-foreground hover:text-fd-accent-foreground ms-2 inline-flex items-center p-2 text-sm transition-colors sm:ms-6"
          href="/docs"
        >
          Docs
        </Link>
        <Link
          className="text-fd-muted-foreground hover:text-fd-accent-foreground hidden items-center p-2 text-sm transition-colors min-[360px]:inline-flex"
          href="/changelog"
        >
          Changelog
        </Link>
        <a
          aria-label="GitHub"
          className="hover:bg-fd-accent hover:text-fd-accent-foreground ms-auto inline-flex items-center rounded-md p-2 transition-colors lg:hidden"
          href={githubUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          <GithubIcon className="size-4.5" />
        </a>
      </div>
    ),
    title: <Logo />,
    url: "/",
  },
  themeSwitch: { enabled: false },
});
