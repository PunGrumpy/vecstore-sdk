"use client";

import { usePathname } from "fumadocs-core/framework";
import type {
  Folder as PageTreeFolder,
  Item as PageTreeItem,
  Node as PageTreeNode,
  Separator as PageTreeSeparator,
} from "fumadocs-core/page-tree";
import {
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarItem,
} from "fumadocs-ui/components/sidebar/base";
import type { ReactNode } from "react";

const containsPath = (
  nodes: readonly PageTreeNode[],
  pathname: string
): boolean =>
  nodes.some((node) => {
    if (node.type === "page") {
      return node.url === pathname;
    }
    if (node.type === "folder") {
      return (
        node.index?.url === pathname || containsPath(node.children, pathname)
      );
    }
    return false;
  });

export const Item = ({ item }: { readonly item: PageTreeItem }) => {
  const pathname = usePathname();
  return (
    <SidebarItem
      active={pathname === item.url}
      className="hover:text-gray-1000 flex w-full items-center rounded-md px-2 py-1 pb-1.5 text-left text-sm text-gray-800 transition-colors data-[active=true]:text-blue-700"
      external={item.external}
      href={item.url}
    >
      {item.name}
    </SidebarItem>
  );
};

export const Folder = ({
  item,
  children,
}: {
  readonly item: PageTreeFolder;
  readonly children: ReactNode;
}) => {
  const pathname = usePathname();

  return (
    <SidebarFolder
      active={containsPath(item.children, pathname)}
      collapsible={item.collapsible !== false}
      defaultOpen={item.defaultOpen}
    >
      {item.index ? (
        <SidebarFolderLink
          active={pathname === item.index.url}
          className="hover:text-gray-1000 flex w-full items-center rounded-md px-2 py-1 pb-1.5 text-left text-sm text-gray-800 transition-colors data-[active=true]:text-blue-700 [&>[data-icon]]:mr-2 [&>[data-icon]]:size-3 [&>[data-icon]]:shrink-0 [&>[data-icon]]:text-gray-700"
          href={item.index.url}
        >
          {item.name}
        </SidebarFolderLink>
      ) : (
        <SidebarFolderTrigger className="hover:text-gray-1000 flex w-full items-center rounded-md px-2 py-1 pb-1.5 text-left text-sm text-gray-800 transition-colors data-[active=true]:text-blue-700 [&>[data-icon]]:mr-2 [&>[data-icon]]:size-3 [&>[data-icon]]:shrink-0 [&>[data-icon]]:text-gray-700">
          {item.name}
        </SidebarFolderTrigger>
      )}
      <SidebarFolderContent className="pb-4">{children}</SidebarFolderContent>
    </SidebarFolder>
  );
};

export const Separator = ({ item }: { readonly item: PageTreeSeparator }) => (
  <p className="text-gray-1000 px-2 pt-4 pb-1 text-xs font-medium">
    {item.name}
  </p>
);
