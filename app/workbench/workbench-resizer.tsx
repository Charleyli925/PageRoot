"use client";

import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

type WorkbenchResizeKind = "sidebar" | "inspector";

type WorkbenchResizerProps = Readonly<{
  kind: WorkbenchResizeKind;
  onCommit?: (width: number) => void;
}>;

const RESIZE_CONFIG: Record<WorkbenchResizeKind, {
  variable: "--workbench-sidebar-width-saved" | "--workbench-inspector-width";
  readVariable: "--workbench-sidebar-width" | "--workbench-inspector-width";
  min: number;
  max: number;
  defaultWidth: number;
  step: number;
  direction: 1 | -1;
  label: string;
}> = {
  sidebar: {
    variable: "--workbench-sidebar-width-saved",
    readVariable: "--workbench-sidebar-width",
    min: 200,
    max: 420,
    defaultWidth: 264,
    step: 16,
    direction: 1,
    label: "调整左侧边栏宽度",
  },
  inspector: {
    variable: "--workbench-inspector-width",
    readVariable: "--workbench-inspector-width",
    min: 280,
    max: 520,
    defaultWidth: 376,
    step: 16,
    direction: -1,
    label: "调整 AI 助手宽度",
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundedPixels(value: number): number {
  return Math.round(value * 10) / 10;
}

function readWidth(root: HTMLElement, variable: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(variable));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStoredWidth(root: HTMLElement, variable: string, fallback: number): number {
  const value = Number.parseFloat(root.style.getPropertyValue(variable));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function WorkbenchResizer({ kind, onCommit }: WorkbenchResizerProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    root: HTMLElement;
    startX: number;
    startWidth: number;
    startStoredWidth: number;
  } | null>(null);
  const config = RESIZE_CONFIG[kind];

  useEffect(() => {
    const handle = handleRef.current;
    const root = handle?.closest<HTMLElement>(".workbench");
    if (!handle || !root) return undefined;

    const syncAriaValue = (value = readWidth(root, config.readVariable, config.defaultWidth)) => {
      handle.setAttribute("aria-valuenow", String(roundedPixels(value)));
    };
    const setWidth = (value: number) => {
      const next = roundedPixels(clamp(value, config.min, config.max));
      root.style.setProperty(config.variable, `${next}px`);
      syncAriaValue();
    };
    const readCommittedWidth = () => config.variable === "--workbench-sidebar-width-saved"
      ? readStoredWidth(root, config.variable, config.defaultWidth)
      : readWidth(root, config.readVariable, config.defaultWidth);
    const finishDrag = (commit: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.root !== root) return;
      if (commit) {
        const width = roundedPixels(readCommittedWidth());
        onCommit?.(width);
      } else {
        root.style.setProperty(config.variable, `${drag.startStoredWidth}px`);
        syncAriaValue(drag.startWidth);
      }
      dragRef.current = null;
      delete root.dataset.resizing;
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.root !== root) return;
      setWidth(drag.startStoredWidth + (event.clientX - drag.startX) * config.direction);
    };
    const onPointerUp = () => finishDrag(true);
    const onPointerCancel = () => finishDrag(false);

    syncAriaValue();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      const drag = dragRef.current;
      if (drag?.root === root) {
        root.style.setProperty(config.variable, `${drag.startStoredWidth}px`);
        dragRef.current = null;
        delete root.dataset.resizing;
      }
    };
  }, [config, kind, onCommit]);

  const reset = () => {
    const handle = handleRef.current;
    const root = handle?.closest<HTMLElement>(".workbench");
    if (!handle || !root) return;
    root.style.setProperty(config.variable, `${config.defaultWidth}px`);
    syncResetAria(handle, root, config);
    onCommit?.(config.defaultWidth);
  };

  return (
    <div
      ref={handleRef}
      className={`workbench-resizer workbench-resizer-${kind}`}
      role="separator"
      tabIndex={0}
      aria-label={config.label}
      aria-orientation="vertical"
      aria-valuemin={config.min}
      aria-valuemax={config.max}
      aria-valuenow={config.defaultWidth}
      data-resizer={kind}
      data-testid={`workbench-resizer-${kind}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const handle = handleRef.current;
        const root = handle?.closest<HTMLElement>(".workbench");
        if (!handle || !root) return;
        event.preventDefault();
        dragRef.current = {
          root,
          startX: event.clientX,
          startWidth: readWidth(root, config.readVariable, config.defaultWidth),
          startStoredWidth: readStoredWidth(root, config.variable, config.defaultWidth),
        };
        root.dataset.resizing = kind;
        handle.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const handle = handleRef.current;
        if (!drag || !handle || drag.root !== handle.closest(".workbench")) return;
        const next = roundedPixels(clamp(
          drag.startStoredWidth + (event.clientX - drag.startX) * config.direction,
          config.min,
          config.max,
        ));
        drag.root.style.setProperty(config.variable, `${next}px`);
        handle.setAttribute(
          "aria-valuenow",
          String(roundedPixels(readWidth(drag.root, config.readVariable, config.defaultWidth))),
        );
      }}
      onPointerUp={() => finishElementDrag(handleRef, dragRef, config, onCommit)}
      onPointerCancel={() => cancelElementDrag(handleRef, dragRef, config)}
      onDoubleClick={(event) => {
        event.preventDefault();
        reset();
      }}
      onKeyDown={(event) => {
        const handle = handleRef.current;
        const root = handle?.closest<HTMLElement>(".workbench");
        if (!handle || !root) return;
        if (event.key === "Home") {
          event.preventDefault();
          reset();
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          root.style.setProperty(config.variable, `${config.max}px`);
          syncResetAria(handle, root, config);
          onCommit?.(config.max);
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? config.step : -config.step;
        const current = readStoredWidth(root, config.variable, config.defaultWidth);
        const next = roundedPixels(clamp(current + delta * config.direction, config.min, config.max));
        root.style.setProperty(config.variable, `${next}px`);
        syncResetAria(handle, root, config);
        onCommit?.(roundedPixels(
          config.variable === "--workbench-sidebar-width-saved"
            ? readStoredWidth(root, config.variable, next)
            : readWidth(root, config.readVariable, next),
        ));
      }}
    >
      <span className="workbench-resizer-grip" aria-hidden="true" />
    </div>
  );
}

function syncResetAria(
  handle: HTMLElement,
  root: HTMLElement,
  config: typeof RESIZE_CONFIG[WorkbenchResizeKind],
) {
  handle.setAttribute(
    "aria-valuenow",
    String(roundedPixels(readWidth(root, config.readVariable, config.defaultWidth))),
  );
}

function finishElementDrag(
  handleRef: RefObject<HTMLDivElement | null>,
  dragRef: MutableRefObject<{
    root: HTMLElement;
    startX: number;
    startWidth: number;
    startStoredWidth: number;
  } | null>,
  config: typeof RESIZE_CONFIG[WorkbenchResizeKind],
  onCommit?: (width: number) => void,
) {
  const handle = handleRef.current;
  const drag = dragRef.current;
  if (!handle || !drag) return;
  const width = roundedPixels(
    config.variable === "--workbench-sidebar-width-saved"
      ? readStoredWidth(drag.root, config.variable, config.defaultWidth)
      : readWidth(drag.root, config.readVariable, config.defaultWidth),
  );
  dragRef.current = null;
  delete drag.root.dataset.resizing;
  onCommit?.(width);
}

function cancelElementDrag(
  handleRef: RefObject<HTMLDivElement | null>,
  dragRef: MutableRefObject<{
    root: HTMLElement;
    startX: number;
    startWidth: number;
    startStoredWidth: number;
  } | null>,
  config: typeof RESIZE_CONFIG[WorkbenchResizeKind],
) {
  const handle = handleRef.current;
  const drag = dragRef.current;
  if (!handle || !drag) return;
  drag.root.style.setProperty(config.variable, `${drag.startStoredWidth}px`);
  dragRef.current = null;
  delete drag.root.dataset.resizing;
  syncResetAria(handle, drag.root, config);
}
