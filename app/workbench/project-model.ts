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
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    return sourcePath.slice("/private".length);
  }
  if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    return sourcePath.slice("/private".length);
  }
  return sourcePath;
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
  const separatorIndex = Math.max(
    sourcePath.lastIndexOf("/"),
    sourcePath.lastIndexOf("\\"),
  );
  if (separatorIndex < 0) return sourcePath;
  return separatorIndex === 0
    ? sourcePath.slice(0, 1)
    : sourcePath.slice(0, separatorIndex);
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

export function workspaceFileLabel(relativePath: string): string {
  if (relativePath === "PROJECT.md") return "项目规则";
  if (relativePath === "runtime-state.json") return "运行状态";
  if (relativePath === "edit-audit.jsonl") return "编辑记录";
  if (relativePath.endsWith("/PROMPT.md")) return "本轮 Prompt";
  if (relativePath.endsWith("/change-request.json")) return "本轮修改要求";
  if (relativePath.endsWith("/input/AI_RULES.md")) return "本轮 AI 规则";
  return "项目记录";
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

export function projectMarkdown(name: string): string {
  return `# ${fileStem(name)}\n\n- 入口文件：${name}\n- 默认延续当前页面的视觉语言、组件样式和响应式行为。\n- 在这里补充页面用途、长期风格和需要跨轮次持续遵循的约束。\n`;
}
