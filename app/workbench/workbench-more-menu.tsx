"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CheckSquareIcon } from "@phosphor-icons/react/dist/csr/CheckSquare";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";

type MoreMenuItem = Readonly<{
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  dividerBefore?: boolean;
  disabled?: boolean;
  reason?: string;
  checked?: boolean;
  keepOpen?: boolean;
}>;

export type WorkbenchMoreMenuProps = Readonly<{
  isHistory?: boolean;
  canShowInFolder: boolean;
  onShowInFolder: () => void;
  canOpenInBrowser: boolean;
  onOpenInBrowser: () => void;
  canExportCurrentHtml: boolean;
  onExportCurrentHtml: (saveVersion?: boolean) => void;
  canSaveCurrentVersion?: boolean;
  onSaveCurrentVersion?: () => void;
  onOpenPreservedDrafts?: () => void;
  canReloadCurrentSource: boolean;
  reloadCurrentSourceUnavailableReason?: string;
  onReloadCurrentSource: () => void;
  onRetryDynamicContent?: () => void;
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
  isHistory = false,
  canShowInFolder,
  onShowInFolder,
  canOpenInBrowser,
  onOpenInBrowser,
  canExportCurrentHtml,
  onExportCurrentHtml,
  canSaveCurrentVersion = false,
  onSaveCurrentVersion,
  onOpenPreservedDrafts,
  canReloadCurrentSource,
  reloadCurrentSourceUnavailableReason,
  onReloadCurrentSource,
  onRetryDynamicContent,
}: WorkbenchMoreMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [saveVersionOnExport, setSaveVersionOnExport] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const items = useMemo<readonly MoreMenuItem[]>(() => [
    ...(!isHistory && onSaveCurrentVersion ? [{
      id: "save-version", label: "保存为新版本",
      icon: <FloppyDiskIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onSaveCurrentVersion, disabled: !canSaveCurrentVersion,
    }] : []),
    {
      id: "show-in-folder",
      label: isHistory ? "在 Finder 中显示当前工作文件" : "在 Finder 中显示",
      icon: <FolderOpenIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onShowInFolder,
    },
    {
      id: "open-in-browser",
      label: isHistory ? "在浏览器中打开当前工作文件" : "在默认浏览器中打开",
      icon: <ArrowSquareOutIcon aria-hidden="true" size={16} weight="bold" />,
      onSelect: onOpenInBrowser,
    },
    {
      id: "export-html",
      label: isHistory ? "导出此版本…" : "导出当前 HTML…",
      icon: <DownloadSimpleIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: () => onExportCurrentHtml(!isHistory && saveVersionOnExport),
      dividerBefore: true,
    },
    ...(!isHistory && onSaveCurrentVersion && canExportCurrentHtml ? [{
      id: "export-save-version", label: "同时保存为新版本",
      icon: saveVersionOnExport ? <CheckSquareIcon aria-hidden="true" size={16} /> : <SquareIcon aria-hidden="true" size={16} />,
      onSelect: () => setSaveVersionOnExport((value) => !value),
      checked: saveVersionOnExport, keepOpen: true, disabled: !canSaveCurrentVersion,
    }] : []),
    ...(onOpenPreservedDrafts ? [{
      id: "preserved-drafts", label: "找回此前的稿件…",
      icon: <ClockCounterClockwiseIcon aria-hidden="true" size={16} />,
      onSelect: onOpenPreservedDrafts,
    }] : []),
    ...(onRetryDynamicContent ? [{
      id: "retry-dynamic",
      label: "重新加载动态内容",
      icon: <ArrowClockwiseIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onRetryDynamicContent,
    }] : []),
    {
      id: "reload-source",
      label: "从磁盘重新载入 HTML",
      icon: <ArrowClockwiseIcon aria-hidden="true" size={16} weight="duotone" />,
      onSelect: onReloadCurrentSource,
      dividerBefore: true,
      disabled: !canReloadCurrentSource,
      reason: reloadCurrentSourceUnavailableReason,
    },
  ], [
    canReloadCurrentSource,
    isHistory,
    onExportCurrentHtml,
    onOpenInBrowser,
    onReloadCurrentSource,
    reloadCurrentSourceUnavailableReason,
    onRetryDynamicContent,
    onShowInFolder,
    canSaveCurrentVersion,
    canExportCurrentHtml,
    onSaveCurrentVersion,
    onOpenPreservedDrafts,
    saveVersionOnExport,
  ]);
  const visibleItems = useMemo(() => items.filter((item) => (
    item.id === "show-in-folder" ? canShowInFolder
      : item.id === "open-in-browser" ? canOpenInBrowser
        : item.id === "export-html" ? canExportCurrentHtml
          : item.id === "reload-source" ? canReloadCurrentSource || Boolean(reloadCurrentSourceUnavailableReason) : true
  )), [
    canExportCurrentHtml,
    canOpenInBrowser,
    canReloadCurrentSource,
    canShowInFolder,
    items,
    reloadCurrentSourceUnavailableReason,
  ]);
  const interactiveItems = useMemo(
    () => visibleItems.filter((item) => !item.disabled),
    [visibleItems],
  );
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
      if (!menuRef.current?.contains(document.activeElement)) itemRefs.current.get(interactiveItems[0]?.id || "")?.focus();
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
      if (!interactiveItems.length) return;
      const currentIndex = interactiveItems.findIndex(
        (item) => item.id === document.activeElement?.getAttribute("data-menu-item"),
      );
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? interactiveItems.length - 1
          : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + interactiveItems.length)
            % interactiveItems.length;
      itemRefs.current.get(interactiveItems[nextIndex]?.id || "")?.focus();
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
  }, [interactiveItems, open, visibleItems]);

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
          else { setSaveVersionOnExport(false); setOpen(true); }
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
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              data-menu-item={item.id}
              disabled={item.disabled}
              aria-describedby={item.reason ? `${menuId}-${item.id}-reason` : undefined}
                onClick={() => {
                  if (!item.keepOpen) close();
                  item.onSelect();
                }}
              >
                {item.icon}
                <span className="workbench-more-menu-copy">
                  <span>{item.label}</span>
                  {item.reason ? (
                    <small id={`${menuId}-${item.id}-reason`}>{item.reason}</small>
                  ) : null}
                </span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
