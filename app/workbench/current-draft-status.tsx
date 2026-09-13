"use client";

import { useState } from "react";
import type { VersionWorkflowSnapshot } from "../application/version-workflow.js";

export function CurrentDraftStatus({ state, contextKey, onRetry, onShowFile }: {
  state?: VersionWorkflowSnapshot | null;
  contextKey: string;
  onRetry(): void;
  onShowFile(path: string): void;
}) {
  const [dismissed, setDismissed] = useState("");
  const version = state?.draftVersion;
  const exported = state?.export;
  const belongs = (value: { context: { projectId: string; documentId: string } | null } | undefined) =>
    Boolean(value?.context && `${value.context.projectId}:${value.context.documentId}` === contextKey);
  const showExport = belongs(exported) && exported?.phase !== "cancelled"
    && (!belongs(version) || (exported?.sequence || 0) > (version?.sequence || 0));
  const item = showExport ? exported : belongs(version) ? version : null;
  if (!item) return null;
  const key = `${contextKey}:${item.sequence}:${item.phase}`;
  if (dismissed === key) return null;
  const busy = ["exporting", "saving-version", "saving"].includes(item.phase);
  const label = showExport
    ? exported?.phase === "exporting" ? "正在导出…"
      : exported?.phase === "saving-version" ? "HTML 已导出，正在保存版本…"
        : exported?.phase === "exported" ? "HTML 已导出"
          : exported?.phase === "download-started" ? "HTML 下载已开始" : exported?.reason
    : version?.phase === "saving" ? "正在保存版本…"
      : version?.phase === "saved" ? `已保存 V${version.result?.versionOrdinal}`
        : version?.phase === "unchanged" ? "当前内容已保存在历史版本中" : version?.reason;
  const canRetry = !busy && (showExport ? exported?.phase === "version-pending"
    && Boolean(exported.versionOperationId && exported.versionOperationId === version?.operationId)
    : ["unknown", "failed", "refresh-pending"].includes(version?.phase || ""));
  return <div className="current-draft-result" role="status">
    <span>{label}</span>
    {showExport && exported?.path ? <button type="button" onClick={() => onShowFile(exported.path!)}>显示文件</button> : null}
    {canRetry ? <button type="button" onClick={onRetry}>{version?.phase === "unknown" ? "查询保存结果" : "重试保存版本"}</button> : null}
    {!busy ? <button type="button" aria-label="关闭操作结果" onClick={() => setDismissed(key)}>关闭</button> : null}
  </div>;
}
