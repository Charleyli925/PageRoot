import type { WorkbenchTab } from "../application/workbench-tabs-session.js";
import type { CanvasMode } from "./types";

type PresentationInput = {
  project: { projectId: string | null; documentId: string | null; sourcePath: string | null };
  version: {
    versions: readonly { id: string; label: string; displayFileName?: string }[];
    currentBasedOnVersionId: string | null; latestVersionId: string | null;
    viewingVersionId: string | null; viewMode: string;
  };
  activeTab: WorkbenchTab | null;
  runtimeOwnerTabId?: string | null;
  canvasMode: CanvasMode;
  reviewActive: boolean;
  activeRunStatus?: string;
  hasReadyPayload: boolean;
  hasReadyReviewSession: boolean;
  reviewPreparing: boolean;
  canShowCurrentFileInFolder: boolean;
  canOpenCurrentHtmlInDefaultBrowser: boolean;
  persistState: string;
  editRevision: number;
  lastPersistedRevision: number;
  hasWorkspaceController: boolean;
  projectHydrating: boolean;
  projectLoadError: boolean;
  viewTransitioning: boolean;
  runInProgress: boolean;
  workspaceIssue: boolean;
  externalSourcePreview: boolean;
  hasDocumentHistoryAction: boolean;
  interactionLocked: boolean;
};

export function deriveWorkbenchPresentation(input: PresentationInput) {
  const { project, version, activeTab, runInProgress, interactionLocked } = input;
  const sameDocument = Boolean(project.projectId && project.documentId && activeTab?.kind === "document"
    && activeTab.projectId === project.projectId && activeTab.documentId === project.documentId);
  // A source-less document has no registered Project identity. Its existing
  // navigation runtime owner still binds the visible in-memory source to a tab.
  const sameUnsavedDocument = !project.sourcePath && !project.projectId && !project.documentId
    && activeTab?.kind === "document" && activeTab.tabId === input.runtimeOwnerTabId;
  const hasDocumentTarget = sameDocument || sameUnsavedDocument;
  const reviewActive = sameDocument && input.reviewActive;
  const isHistory = sameDocument && version.viewMode === "history";
  const displayedVersionId = sameDocument
    ? isHistory ? version.viewingVersionId : version.currentBasedOnVersionId
    : null;
  const displayedVersion = version.versions.find((row) => row.id === displayedVersionId) || null;
  const reviewAvailable = Boolean(sameDocument && input.activeRunStatus === "ready-to-open"
    && input.hasReadyPayload && !input.hasReadyReviewSession && !input.reviewPreparing);
  const editReason = reviewActive ? "完成审阅后可继续编辑"
    : runInProgress ? "本轮还在进行，结束或采纳后可回到编辑"
      : isHistory ? "历史版本只读，回到当前版本后可编辑"
        : !hasDocumentTarget ? "请先打开当前文档" : undefined;
  const previewReason = !hasDocumentTarget ? "请先打开当前文档" : reviewActive ? "完成审阅后可继续预览"
    : interactionLocked ? "当前状态只能使用编辑画布" : undefined;
  const reviewReason = !sameDocument ? "请先打开当前文档" : reviewActive ? "正在审阅 AI 修改"
    : input.reviewPreparing ? "正在准备审阅…"
      : !reviewAvailable ? "有待审阅修改时自动可用" : undefined;
  const fileReady = hasDocumentTarget && input.hasWorkspaceController && !input.projectHydrating
    && !input.projectLoadError && !input.viewTransitioning;
  const canReloadCurrentSource = Boolean(sameDocument && project.sourcePath && version.viewMode === "current"
    && input.persistState === "idle" && input.editRevision === input.lastPersistedRevision
    && !runInProgress && !input.projectHydrating && !input.projectLoadError
    && !input.workspaceIssue && !input.externalSourcePreview && !input.viewTransitioning
    && !input.hasDocumentHistoryAction);
  return {
    projectId: sameDocument ? project.projectId : null,
    documentId: sameDocument ? project.documentId : null,
    displayedVersion,
    displayedVersionId: displayedVersion?.id || null,
    selectedVersionId: displayedVersion?.id || null,
    currentEditingVersionId: sameDocument ? version.currentBasedOnVersionId : null,
    latestVersionId: sameDocument ? version.latestVersionId : null,
    tabId: activeTab?.tabId || null,
    tabTitle: isHistory
      ? displayedVersion?.displayFileName || displayedVersion?.label || "历史版本"
      : activeTab?.title || "",
    viewLabel: !hasDocumentTarget ? null : reviewActive ? "审阅" : isHistory ? "历史" : "当前",
    isHistory,
    // The displayed canvas mode remains the real runtime mode, including a
    // read-only history rendered by the edit canvas. Projection cannot switch it.
    mode: reviewActive ? "review" : input.canvasMode,
    edit: { enabled: !editReason, selected: !reviewActive && input.canvasMode === "edit", reason: editReason },
    preview: { enabled: hasDocumentTarget && !reviewActive && !interactionLocked, selected: !reviewActive && input.canvasMode === "preview", reason: previewReason },
    review: { enabled: !reviewActive && !input.reviewPreparing && reviewAvailable, selected: reviewActive, reason: reviewReason },
    reviewAvailable,
    canShowInFinder: sameDocument && input.canShowCurrentFileInFolder,
    canOpenCurrentHtml: sameDocument && input.canOpenCurrentHtmlInDefaultBrowser && input.persistState === "idle"
      && input.editRevision === input.lastPersistedRevision,
    canExportCurrentHtml: fileReady,
    canReloadCurrentSource,
    refreshAvailable: Boolean(hasDocumentTarget && (input.canvasMode === "preview" || reviewActive)
      && !input.projectHydrating && !input.projectLoadError && !input.viewTransitioning),
  };
}

export type WorkbenchPresentation = ReturnType<typeof deriveWorkbenchPresentation>;
