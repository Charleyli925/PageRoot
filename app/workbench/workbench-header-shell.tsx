"use client";

import type { HTMLAttributes } from "react";

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function WorkbenchHeaderShell({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <header
      {...props}
      className={joinClassNames("workbench-header", className)}
    />
  );
}

export function WorkbenchHeaderActions({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      {...props}
      className={joinClassNames("header-actions", className)}
    />
  );
}
