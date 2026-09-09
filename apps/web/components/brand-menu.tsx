"use client";

import { CheckIcon, DownloadIcon, PenToolIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent, ReactNode, RefObject } from "react";
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
      className="flex flex-col gap-2 text-left"
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
      <span className="border-gray-alpha-400 flex h-14 w-36 items-center justify-center rounded-lg border bg-black text-white">
        {copied ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-900">
            <CheckIcon aria-hidden className="size-3.5" />
            Copied to clipboard
          </span>
        ) : (
          children
        )}
      </span>
      <span className="text-gray-1000 text-[13px]">{label}</span>
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
    if (!open) {
      return;
    }
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
      anchorRef.current?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const openMenu = (event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + MENU_GAP });
    setOpen(true);
  };

  return (
    <>
      <span
        className="inline-flex items-center"
        onContextMenu={openMenu}
        ref={anchorRef}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              aria-label="Brand assets"
              className="border-gray-alpha-400 bg-background-100 fixed z-50 w-[328px] rounded-xl border p-4 shadow-lg"
              id={menuId}
              ref={menuRef}
              role="menu"
              style={position}
              tabIndex={-1}
            >
              <div className="flex gap-4">
                <CopyTile label="Copy wordmark" svgRef={wordmarkRef}>
                  <VecstoreWordmark className="h-5 w-auto" ref={wordmarkRef} />
                </CopyTile>
                <CopyTile label="Copy logo" svgRef={markRef}>
                  <VecstoreIcon className="size-5" ref={markRef} />
                </CopyTile>
              </div>
              <div className="border-gray-alpha-400 my-4 border-t" />
              <div className="flex flex-col gap-1">
                <a
                  className="text-gray-1000 inline-flex items-center gap-3 rounded-md px-2 py-2 text-[14px] transition-colors hover:bg-gray-100"
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
                  className="text-gray-1000 inline-flex items-center gap-3 rounded-md px-2 py-2 text-[14px] transition-colors hover:bg-gray-100"
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
