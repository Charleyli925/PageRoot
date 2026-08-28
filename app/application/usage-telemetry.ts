export type UsageEventProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

export type DesktopUsageApi = {
  capture: (
    event: string,
    properties?: UsageEventProperties,
    projectId?: string,
  ) => void;
};

export function captureUsageEvent(
  event: string,
  properties: UsageEventProperties = {},
  projectId?: string,
): void {
  if (typeof window === "undefined") return;
  window.htmlAIUsage?.capture(event, properties, projectId);
}

export function countBucket(value: number): "0" | "1" | "2-5" | "6-20" | "21+" {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 5) return "2-5";
  if (value <= 20) return "6-20";
  return "21+";
}

export function usageFingerprint(value: unknown): string {
  const text = value instanceof Error
    ? `${value.name}\n${value.stack || value.message}`
    : String(value ?? "");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const point = text.charCodeAt(index);
    first ^= point;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= point + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${
    second.toString(16).padStart(8, "0")
  }`;
}

export function noticeUsageCode(dedupeKey?: string): string {
  const key = String(dedupeKey || "");
  if (key.startsWith("attachment-cleanup-")) return "attachment_cleanup";
  if (key.startsWith("attachment-batch-")) return "attachment_batch";
  if (key.startsWith("attachment-preview-")) return "attachment_preview";
  if (key.startsWith("attachment-download-")) return "attachment_download";
  if (key.startsWith("ai-run-cancelled:")) return "ai_run_cancelled";
  if (key.startsWith("background-version:")) return "background_version";
  if (key.startsWith("qoder-handoff:")) return "qoder_handoff";
  if (key.startsWith("reveal-version-file-")) return "reveal_version_file";
  const known = new Set([
    "autosave-recovery",
    "browser-file-error",
    "current-version-result",
    "export",
    "history-navigation",
    "project-open-error",
    "project-registration",
    "reveal-request-folder",
    "show-project-in-folder-error",
    "source-reload",
    "submit-blocked",
    "unfinished-comment-draft",
    "unsafe-comment-targets",
  ]);
  return known.has(key) ? key.replaceAll("-", "_") : "uncatalogued";
}

export function editPropertyGroup(property?: string): string {
  const normalized = String(property || "").toLowerCase();
  if (!normalized) return "unknown";
  if (/color/u.test(normalized)) return "color";
  if (/font|weight|italic|underline|text/u.test(normalized)) return "font";
  if (/background/u.test(normalized)) return "background";
  if (/border/u.test(normalized)) return "border";
  if (/padding|margin|gap|spacing/u.test(normalized)) return "spacing";
  if (/display|position|width|height|align|justify|order|layout/u.test(normalized)) {
    return "layout";
  }
  return "unknown";
}

declare global {
  interface Window {
    htmlAIUsage?: DesktopUsageApi;
  }
}
