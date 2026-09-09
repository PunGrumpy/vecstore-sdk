"use client";

import { CheckIcon, DownloadIcon, PenToolIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

import { VecstoreIcon } from "@/components/icons/vecstore";
import { VecstoreWordmark } from "@/components/icons/vecstore-wordmark";
import { githubUrl } from "@/lib/landing-content";

const COPIED_MS = 1500;
const MENU_GAP = 8;

const serialize = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGSVGElement)) {
    return "";
  }
  const ink = document.documentElement.classList.contains("dark")
    ? "#ededed"
    : "#171717";
  clone.removeAttribute("class");
  clone.removeAttribute("aria-hidden");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer()
    .serializeToString(clone)
    .replaceAll("currentColor", ink);
};

const CopyTile = ({
  children,
  label,
  svgRef,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly svgRef: RefObject<SVGSVGElement | null>;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      className="text-gray-1000 hover:bg-gray-alpha-100 flex min-w-0 flex-col gap-2 rounded-md p-2 text-left text-[14px] transition-colors"
      onClick={async (event) => {
        event.stopPropagation();
        if (svgRef.current) {
          await navigator.clipboard.writeText(serialize(svgRef.current));
          setCopied(true);
        }
      }}
      role="menuitem"
      type="button"
    >
      <span className="border-gray-alpha-400 bg-background-200 text-gray-1000 relative flex h-12 w-full items-center justify-center overflow-hidden rounded-md border px-4">
        {copied ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-800">
            <CheckIcon aria-hidden className="size-3.5" />
            Copied to clipboard
          </span>
        ) : (
          children
        )}
      </span>
      <span className="px-1">{label}</span>
    </button>
  );
};

export const BrandMenu = ({ children }: { readonly children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<SVGSVGElement>(null);
  const markRef = useRef<SVGSVGElement>(null);
  const menuId = useId();

  useEffect(() => {
    const anchor = anchorRef.current?.closest("a") ?? anchorRef.current;
    if (!anchor) {
      return;
    }
    const handle = (event: Event) => {
      event.preventDefault();
      const rect = anchor.getBoundingClientRect();
      setPosition({ left: rect.left, top: rect.bottom + MENU_GAP });
      setOpen(true);
    };
    anchor.addEventListener("contextmenu", handle);
    return () => anchor.removeEventListener("contextmenu", handle);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") {
        return;
      }
      if (
        event instanceof PointerEvent &&
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
      (anchorRef.current?.closest("a") ?? anchorRef.current)?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ??
        []),
    ];
    const active = document.activeElement;
    const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
    const step = event.key === "ArrowDown" ? 1 : -1;
    items.at((index + step) % items.length)?.focus();
  };

  return (
    <>
      <span className="inline-flex items-center" ref={anchorRef}>
        {children}
      </span>
      {open
        ? createPortal(
            <div
              aria-label="Brand assets"
              className="border-gray-alpha-400 bg-background-100 fixed z-50 m-0 w-[325px] max-w-[calc(100vw-32px)] rounded-xl border p-1.5 opacity-100 transition-opacity duration-100 starting:opacity-0"
              id={menuId}
              onKeyDown={moveFocus}
              ref={menuRef}
              role="menu"
              style={position}
              tabIndex={-1}
            >
              <div className="grid grid-cols-2">
                <CopyTile label="Copy wordmark" svgRef={wordmarkRef}>
                  <VecstoreWordmark
                    className="h-[21px] w-auto"
                    ref={wordmarkRef}
                  />
                </CopyTile>
                <CopyTile label="Copy logo" svgRef={markRef}>
                  <VecstoreIcon className="size-[21px]" ref={markRef} />
                </CopyTile>
              </div>
              <div className="border-gray-alpha-400 -mx-1.5 mt-2 border-t px-2 pt-2">
                <a
                  className="text-gray-1000 hover:bg-gray-alpha-100 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] transition-colors"
                  href={`${githubUrl}/tree/main/assets`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                  }}
                  rel="noopener noreferrer"
                  role="menuitem"
                  target="_blank"
                >
                  <DownloadIcon aria-hidden className="size-4" />
                  Download brand assets
                </a>
                <Link
                  className="text-gray-1000 hover:bg-gray-alpha-100 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] transition-colors"
                  href="/docs/guides/design"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                  }}
                  role="menuitem"
                >
                  <PenToolIcon aria-hidden className="size-4" />
                  Design notes
                </Link>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
};
