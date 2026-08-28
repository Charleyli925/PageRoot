export function deriveWorkbenchHeaderCapabilities(
  activeRunStatus: string | undefined,
  hasReadyPayload: boolean,
  hasReadyReviewSession: boolean,
  reviewPreparing: boolean,
  canShowCurrentFileInFolder: boolean,
  canOpenCurrentHtmlInDefaultBrowser: boolean,
  persistState: string,
  editRevision: number,
  lastPersistedRevision: number,
  hasWorkspaceController: boolean,
  projectHydrating: boolean,
  projectLoadError: boolean,
  viewTransitioning: boolean,
  sourcePath: string | null,
  viewMode: string,
  runInProgress: boolean,
  workspaceIssue: boolean,
  externalSourcePreview: boolean,
  hasDocumentHistoryAction: boolean,
) {
  return {
    reviewAvailable: Boolean(
      activeRunStatus === "ready-to-open"
      && hasReadyPayload
      && !hasReadyReviewSession
      && !reviewPreparing,
    ),
    canShowInFinder: canShowCurrentFileInFolder,
    canOpenCurrentHtml: Boolean(
      canOpenCurrentHtmlInDefaultBrowser
      && persistState === "idle"
      && editRevision === lastPersistedRevision,
    ),
    canExportCurrentHtml: Boolean(
      hasWorkspaceController
      && !projectHydrating
      && !projectLoadError
      && !viewTransitioning,
    ),
    canReloadCurrentSource: Boolean(
      sourcePath
      && viewMode === "current"
      && persistState === "idle"
      && editRevision === lastPersistedRevision
      && !runInProgress
      && !projectHydrating
      && !projectLoadError
      && !workspaceIssue
      && !externalSourcePreview
      && !viewTransitioning
      && !hasDocumentHistoryAction,
    ),
  };
}
