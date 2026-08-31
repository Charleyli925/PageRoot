"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";

type MoreMenuItem = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  dividerBefore?: boolean;
}>;

export type WorkbenchMoreMenuProps = Readonly<{
  canShowInFolder: boolean;
  onShowInFolder: () => void;
  canOpenInBrowser: boolean;
  onOpenInBrowser: () => void;
  canExportCurrentHtml: boolean;
  onExportCurrentHtml: () => void;
  canReloadCurrentSource: boolean;
  onReloadCurrentSource: () => void;
}>;

function menuPosition(trigger: HTMLButtonElement) {
  const rect = trigger.getBoundingClientRect();
  const width = 220;
  return {
    top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 320)),
    left: Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    ),
  };
}

export function WorkbenchMoreMenu({
  canShowInFolder,
  onShowInFolder,
  canOpenInBrowser,
  onOpenInBrowser,
  canExportCurrentHtml,
  onExportCurrentHtml,
  canReloadCurrentSource,
  onReloadCurrentSource,
}: WorkbenchMoreMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const items = useMemo<readonly MoreMenuItem[]>(() => [
    {
      id: "show-in-folder",
      label: "在 Finder 中显示",
      icon: <FolderOpenIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onShowInFolder,
    },
    {
      id: "open-in-browser",
      label: "在默认浏览器中打开",
      icon: <ArrowSquareOutIcon aria-hidden="true" size={16} weight="bold" />,
      onSelect: onOpenInBrowser,
    },
    {
      id: "export-html",
      label: "导出当前 HTML…",
      icon: <DownloadSimpleIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onExportCurrentHtml,
      dividerBefore: true,
    },
    {
      id: "reload-source",
      label: "重新载入当前 HTML",
      icon: <ArrowClockwiseIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onReloadCurrentSource,
      dividerBefore: true,
    },
  ], [
    onExportCurrentHtml,
    onOpenInBrowser,
    onReloadCurrentSource,
    onShowInFolder,
  ]);
  const visibleItems = useMemo(() => items.filter((item) => (
    item.id === "show-in-folder" ? canShowInFolder
      : item.id === "open-in-browser" ? canOpenInBrowser
        : item.id === "export-html" ? canExportCurrentHtml
          : canReloadCurrentSource
  )), [
    canExportCurrentHtml,
    canOpenInBrowser,
    canReloadCurrentSource,
    canShowInFolder,
    items,
  ]);
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  useEffect(() => {
    if (!open) return undefined;
    const trigger = triggerRef.current;
    if (!trigger) return undefined;
    const updatePosition = () => setPosition(menuPosition(trigger));
    const focusFirst = () => {
      itemRefs.current.get(visibleItems[0]?.id || "")?.focus();
    };
    updatePosition();
    window.requestAnimationFrame(focusFirst);
    const onViewportChange = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trigger.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        // The menu is portalled to body, so allowing the browser's default Tab
        // order would jump past the trigger to the first document tab. Return
        // to the owning control first; the next Tab then follows the toolbar's
        // normal order (and Shift+Tab follows it in reverse).
        event.preventDefault();
        close();
        return;
      }
      const currentIndex = visibleItems.findIndex(
        (item) => item.id === document.activeElement?.getAttribute("data-menu-item"),
      );
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? visibleItems.length - 1
          : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + visibleItems.length)
            % visibleItems.length;
      itemRefs.current.get(visibleItems[nextIndex]?.id || "")?.focus();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, visibleItems]);

  return (
    <span className="workbench-more-menu-wrap">
      <button
        ref={triggerRef}
        className="workbench-more-menu-trigger"
        type="button"
        aria-label="更多"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-tooltip="更多"
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
      >
        <DotsThreeIcon aria-hidden="true" size={18} weight="bold" />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="workbench-more-menu"
          role="menu"
          aria-label="更多操作"
          style={{ left: position.left, top: position.top }}
        >
          {visibleItems.map((item) => (
            <div className="workbench-more-menu-entry" key={item.id}>
              {item.dividerBefore ? <span className="workbench-more-menu-divider" role="separator" /> : null}
              <button
                ref={(element) => {
                  if (element) itemRefs.current.set(item.id, element);
                  else itemRefs.current.delete(item.id);
                }}
                type="button"
                role="menuitem"
                data-menu-item={item.id}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
