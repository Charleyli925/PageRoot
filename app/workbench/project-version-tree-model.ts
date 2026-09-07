import type { ProjectVersionSummary, Version } from "./types";

const HTML_FILE_NAME = /^[^/\\\u0000-\u001f]{1,255}\.html?$/iu;

function normalizedFileName(value: unknown): string {
  const candidate = String(value || "").split(/[\\/]/u).pop()?.trim() || "";
  return HTML_FILE_NAME.test(candidate) ? candidate : "";
}

function fileNameParts(value: string): { stem: string; extension: string } {
  const match = value.match(/^(.*?)(\.[^.]+)$/u);
  return {
    stem: (match?.[1] || value || "版本").replace(/-V\d+$/u, "") || "版本",
    extension: match?.[2] || ".html",
  };
}

export function fallbackVersionFileName(
  currentFileName: string,
  ordinal: number,
): string {
  const current = normalizedFileName(currentFileName);
  const { stem, extension } = fileNameParts(current || "项目.html");
  return `${stem}-V${ordinal}${extension}`;
}

export type VersionSummaryOptions = Readonly<{
  activeVersionId?: string | null;
  latestVersionId?: string | null;
  activeModifiedAt?: string | null;
}>;

export function projectVersionSummariesFromVersions(
  versions: readonly Pick<Version, "id" | "ordinal" | "displayFileName" | "modifiedAt" | "generatedAt" | "basedOnVersionId" | "previousVersionId">[],
  projectId: string,
  documentId: string,
  currentFileName: string,
  options: VersionSummaryOptions = {},
): ProjectVersionSummary[] {
  const activeVersionId = options.activeVersionId || null;
  const latestVersionId = options.latestVersionId || null;
  const activeFileName = normalizedFileName(currentFileName);
  return versions.map((version) => {
    const isActiveWorkingCopy = activeVersionId === null ? null : version.id === activeVersionId;
    const displayFileName = isActiveWorkingCopy
      ? activeFileName
        || normalizedFileName(version.displayFileName)
        || fallbackVersionFileName(currentFileName, version.ordinal)
      : normalizedFileName(version.displayFileName)
        || fallbackVersionFileName(currentFileName, version.ordinal);
    const modifiedAt = isActiveWorkingCopy
      ? String(options.activeModifiedAt || version.modifiedAt || version.generatedAt || "")
      : String(version.modifiedAt || version.generatedAt || "");
    return {
      projectId,
      documentId,
      versionId: version.id,
      ordinal: version.ordinal,
      basedOnVersionId: version.basedOnVersionId || null,
      previousVersionId: version.previousVersionId || null,
      displayFileName,
      modifiedAt,
      isActiveWorkingCopy,
      isLatestOfficial: latestVersionId === null ? null : version.id === latestVersionId,
    };
  });
}

export function projectVersionSummariesFromWorkspace(payload: Record<string, unknown>): ProjectVersionSummary[] {
  if (!payload.projectId || !payload.documentId || !Array.isArray(payload.versions)) throw new TypeError("项目摘要身份无效。");
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  const versions = payload.versions.map((row) => {
    if (!row || typeof row.versionId !== "string" || !row.versionId.trim()
      || ids.has(row.versionId) || !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || ordinals.has(row.ordinal)
      || row.projectId !== payload.projectId || row.documentId !== payload.documentId) throw new TypeError("项目版本摘要身份无效。");
    ids.add(row.versionId); ordinals.add(row.ordinal);
    return { id: row.versionId, ordinal: row.ordinal, displayFileName: row.displayFileName,
      modifiedAt: row.modifiedAt, generatedAt: row.modifiedAt,
      basedOnVersionId: row.basedOnVersionId, previousVersionId: row.previousVersionId };
  });
  for (const key of ["currentBasedOnVersionId", "latestVersionId"]) {
    if (payload[key] != null && !ids.has(String(payload[key]))) throw new TypeError("项目摘要指针无法解析。");
  }
  return projectVersionSummariesFromVersions(versions, String(payload.projectId), String(payload.documentId), "", {
    activeVersionId: payload.currentBasedOnVersionId == null ? null : String(payload.currentBasedOnVersionId),
    latestVersionId: payload.latestVersionId == null ? null : String(payload.latestVersionId),
  });
}

function parsedDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalDate(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function padTimePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatSidebarVersionTime(
  value: string,
  now: Date = new Date(),
): string {
  const date = parsedDate(value);
  const reference = parsedDate(now);
  if (!date || !reference) return "—";
  if (sameLocalDate(date, reference)) {
    return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
  }
  if (date.getFullYear() === reference.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatSidebarVersionDateTime(value: string): string {
  const date = parsedDate(value);
  if (!date) return "时间不可用";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

export function versionInheritanceDescription(
  version: ProjectVersionSummary,
  parent: ProjectVersionSummary | null,
): string {
  if (!parent) {
    return version.isActiveWorkingCopy
      ? "项目初始导入版本 · 当前编辑文件"
      : "项目初始导入版本";
  }
  const isIndependentBranch = Boolean(
    version.basedOnVersionId
    && version.previousVersionId
    && version.basedOnVersionId !== version.previousVersionId,
  );
  return `基于 ${parent.displayFileName} 修改生成${isIndependentBranch ? " · 独立分支" : ""}${version.isActiveWorkingCopy ? " · 当前编辑文件" : ""}`;
}
