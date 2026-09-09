import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import Link from "next/link";

import { footerColumns } from "@/lib/landing-content";

const year = new Date().getFullYear();

export const Footer = () => (
  <footer className="border-gray-alpha-400 border-t">
    <div className="mx-auto grid w-full max-w-(--fd-layout-width) grid-cols-2 gap-10 px-6 py-16 md:flex md:justify-between">
      {footerColumns.map((column) => (
        <nav aria-label={column.title} key={column.title}>
          <h2 className="text-label-12-mono text-gray-1000 mb-4 uppercase">
            {column.title}
          </h2>
          <ul className="flex flex-col gap-3">
            {column.links.map((link) => (
              <li key={link.href}>
                <Link
                  className="text-label-14 hover:text-gray-1000 text-gray-900 transition-colors"
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </div>
    <div className="mx-auto flex w-full max-w-(--fd-layout-width) items-center justify-between gap-4 px-6 pb-10">
      <p className="text-label-14 text-gray-900">
        © {year}{" "}
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-1000 text-gray-900 transition-colors"
          href="https://www.pungrumpy.com"
        >
          Noppakorn Kaewsalabnil
        </a>
        . Released under the MIT License.
      </p>
      <ThemeSwitch mode="light-dark-system" />
    </div>
  </footer>
);
