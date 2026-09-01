import type { ActiveRun } from "../domain/run-lifecycle.js";

export function fileStem(name: string): string {
  return name.replace(/\.html?$/i, "") || "未命名页面";
}

export function localFileNameFromSourcePath(
  sourcePath: string | null | undefined,
): string {
  if (!sourcePath) return "";
  const separatorIndex = Math.max(
    sourcePath.lastIndexOf("/"),
    sourcePath.lastIndexOf("\\"),
  );
  return sourcePath.slice(separatorIndex + 1) || sourcePath;
}

export function fileExtension(name: string): string {
  const matched = name.match(/(\.html?)$/iu);
  return matched?.[1] || "";
}

export function sourceRenameOperationId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  return `rename_${randomId}`;
}

function comparableLocalSourcePath(
  sourcePath: string | null | undefined,
): string {
  if (!sourcePath) return "";
  let normalized = sourcePath.normalize("NFC");
  if (normalized === "/private/var" || normalized.startsWith("/private/var/")) {
    normalized = normalized.slice("/private".length);
  } else if (normalized === "/private/tmp" || normalized.startsWith("/private/tmp/")) {
    normalized = normalized.slice("/private".length);
  }
  try {
    if (
      typeof process !== "undefined"
      && (process.platform === "darwin" || process.platform === "win32")
    ) {
      return normalized.toLocaleLowerCase("en-US");
    }
  } catch {
    // Browser preview has no process; keep the NFC spelling.
  }
  return normalized;
}

export function sameLocalSourcePath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && comparableLocalSourcePath(left) === comparableLocalSourcePath(right),
  );
}

export function folderFromSourcePath(sourcePath: string | null): string {
  if (!sourcePath) return "尚未打开本地文件";
  const normalized = sourcePath.replace(/[\\/]+$/u, "");
  const parts = normalized.split(/[\\/]/u).filter(Boolean);
  if (parts.length === 0) return sourcePath;
  const last = parts.at(-1) || normalized;
  if (/\.html?$/iu.test(last)) {
    return parts.at(-2) || last;
  }
  return last;
}

export function safeVersionLabel(versionId: string): string {
  const match = versionId.match(/(\d+)$/);
  return match ? `版本 ${Number(match[1])}` : versionId;
}

export function displayVersionLabel(ordinal: number): string {
  return Number.isSafeInteger(ordinal) && ordinal > 0
    ? `版本 ${ordinal}`
    : "下一版";
}

export function fileNameFromSourcePath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) || "新版本.html";
}

export function activeRunOperationKey(run: Pick<
  ActiveRun,
  "sourcePath" | "requestId" | "attemptId"
>): string {
  return `${run.sourcePath}\n${run.requestId}\n${run.attemptId}`;
}

export function formatTime(value: unknown, includeSeconds = false): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(date);
}

export function formatProjectTimestamp(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number") || !value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday - startOfDate) / (24 * 60 * 60 * 1000),
  );
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (dayDifference === -1) return `明天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
