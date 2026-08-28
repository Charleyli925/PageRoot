"use client";

import { useEffect, useRef } from "react";

type WorkbenchResizeKind = "sidebar" | "inspector";

type WorkbenchResizerProps = Readonly<{
  kind: WorkbenchResizeKind;
}>;

const RESIZE_CONFIG: Record<WorkbenchResizeKind, {
  variable: "--workbench-sidebar-width" | "--workbench-inspector-width";
  min: number;
  max: number;
  step: number;
  direction: 1 | -1;
  label: string;
}> = {
  sidebar: {
    variable: "--workbench-sidebar-width",
    min: 200,
    max: 420,
    step: 16,
    direction: 1,
    label: "调整左侧边栏宽度",
  },
  inspector: {
    variable: "--workbench-inspector-width",
    min: 280,
    max: 520,
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

export function WorkbenchResizer({ kind }: WorkbenchResizerProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    root: HTMLElement;
    startX: number;
    startWidth: number;
  } | null>(null);
  const config = RESIZE_CONFIG[kind];

  useEffect(() => {
    const handle = handleRef.current;
    const root = handle?.closest<HTMLElement>(".workbench");
    if (!handle || !root) return undefined;

    const syncAriaValue = (value = readWidth(root, config.variable, 376)) => {
      handle.setAttribute("aria-valuenow", String(roundedPixels(value)));
    };
    const setWidth = (value: number) => {
      const next = roundedPixels(clamp(value, config.min, config.max));
      root.style.setProperty(config.variable, `${next}px`);
      syncAriaValue(next);
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.root !== root) return;
      setWidth(drag.startWidth + (event.clientX - drag.startX) * config.direction);
    };
    const finishDrag = () => {
      if (!dragRef.current || dragRef.current.root !== root) return;
      dragRef.current = null;
      delete root.dataset.resizing;
    };

    syncAriaValue();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      if (dragRef.current?.root === root) {
        dragRef.current = null;
        delete root.dataset.resizing;
      }
      if (kind === "sidebar") root.style.removeProperty(config.variable);
    };
  }, [config, kind]);

  const reset = () => {
    const handle = handleRef.current;
    const root = handle?.closest<HTMLElement>(".workbench");
    if (!handle || !root) return;
    root.style.removeProperty(config.variable);
    const value = readWidth(root, config.variable, kind === "sidebar" ? 264 : 376);
    handle.setAttribute("aria-valuenow", String(roundedPixels(value)));
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
      aria-valuenow={kind === "sidebar" ? 264 : 376}
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
          startWidth: readWidth(root, config.variable, kind === "sidebar" ? 264 : 376),
        };
        root.dataset.resizing = kind;
        handle.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const handle = handleRef.current;
        if (!drag || !handle || drag.root !== handle.closest(".workbench")) return;
        const next = roundedPixels(clamp(
          drag.startWidth + (event.clientX - drag.startX) * config.direction,
          config.min,
          config.max,
        ));
        drag.root.style.setProperty(config.variable, `${next}px`);
        handle.setAttribute("aria-valuenow", String(next));
      }}
      onPointerUp={() => {
        if (!dragRef.current) return;
        delete dragRef.current.root.dataset.resizing;
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        if (!dragRef.current) return;
        delete dragRef.current.root.dataset.resizing;
        dragRef.current = null;
      }}
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
          handle.setAttribute("aria-valuenow", String(config.max));
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? config.step : -config.step;
        const current = readWidth(root, config.variable, kind === "sidebar" ? 264 : 376);
        const next = roundedPixels(clamp(current + delta * config.direction, config.min, config.max));
        root.style.setProperty(config.variable, `${next}px`);
        handle.setAttribute("aria-valuenow", String(next));
      }}
    >
      <span className="workbench-resizer-grip" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
