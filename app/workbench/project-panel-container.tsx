"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ProjectCatalogControllerCapability,
  ProjectControllerCapability,
} from "../application/workspace-controller.js";
import { currentWorkingCopyPresentation } from "./project-model";
import type { ProjectPanelPort } from "./project-panel-port";
import {
  ProjectFilesConsole,
  ProjectFilesFooter,
  ProjectFilesHeader,
} from "./project-files-view";
import type {
  CommentAttachment,
  PersistState,
  RecentProject,
  RegisteredProject,
  Version,
  WorkspaceIssue,
} from "./types";
import {
  WorkbenchGlobalSidebar,
  WorkbenchStartPage,
} from "./WorkbenchChrome";
import type { ApplicationUpdateResult } from "./types";

const EMPTY_RULES = Object.freeze({
  open: false,
  path: "PROJECT.md" as const,
  content: "",
  savedContent: "",
  loading: false,
  error: "",
  saving: false,
  saveError: "",
  compositionActive: false,
  editorGeneration: 0,
});

const EMPTY_VERSIONS = Object.freeze({
  versions: Object.freeze([]) as readonly Version[],
  latestVersionId: null,
  currentBasedOnVersionId: null,
  currentExactVersionId: null,
  restoredFromVersionId: null,
  viewMode: "current" as const,
  viewingVersionId: null,
});

export type ProjectPanelCapability = ProjectControllerCapability<
  Version
>;
export type ProjectCatalogCapability = ProjectCatalogControllerCapability<
  RecentProject,
  RegisteredProject
>;

export type ProjectPanelContext = Readonly<{
  projectName: string;
  browserPreviewOnly: boolean;
  saveStatusLabel: string;
  persistState: PersistState;
  runInProgress: boolean;
  projectRecordsPreparing: boolean;
  projectRecordsError: string;
  projectHydrating: boolean;
  projectLoadError: string | null;
  workspaceIssue: WorkspaceIssue | null;
  viewTransitioning: boolean;
  canShowCurrentFileInFolder: boolean;
  attachmentObjectUrls: Record<string, string>;
}>;

export type ProjectPanelHostActions = Readonly<{
  onShowInFolder(): void | Promise<void>;
  onExport(): void | Promise<void>;
  onClose(): void;
  prepareProjectRecords(): void | Promise<void>;
  ensureAttachmentObjectUrl(attachment: CommentAttachment): Promise<string>;
  openAttachmentPreview(attachment: CommentAttachment): void | Promise<void>;
  downloadAttachment(attachment: CommentAttachment): void | Promise<void>;
  viewHistoryVersion(version: Version): void | Promise<void>;
  onRulesViewed(): void;
}>;

export const ProjectPanelContainer = memo(function ProjectPanelContainer({
  capability,
  panelPort,
  context,
  actions,
}: {
  capability: ProjectPanelCapability;
  panelPort: ProjectPanelPort;
  context: ProjectPanelContext;
  actions: ProjectPanelHostActions;
}) {
  const snapshot = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const panelSnapshot = useSyncExternalStore(
    panelPort.subscribe,
    panelPort.getSnapshot,
    panelPort.getSnapshot,
  );
  const projectRulesEditorRef = useRef<HTMLTextAreaElement>(null);
  const handledOpenRulesRevisionRef = useRef(0);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [projectRulesEdited, setProjectRulesEdited] = useState(false);
  const rules = snapshot.rules ?? EMPTY_RULES;
  const versionSnapshot = snapshot.versions ?? EMPTY_VERSIONS;
  const versions = versionSnapshot.versions;
  const projectId = snapshot.session?.projectId || null;
  const activeFileView = rules.open ? {
    path: rules.path,
    content: rules.content,
    savedContent: rules.savedContent,
    loading: rules.loading,
    ...(rules.error ? { error: rules.error } : {}),
  } : null;

  useEffect(() => () => {
    capability.commands.leaveRulesEditor();
  }, [capability]);

  useEffect(() => {
    if (rules.open) actions.onRulesViewed();
  }, [actions, rules.open]);

  useEffect(() => {
    const revision = panelSnapshot.openRulesRevision;
    if (revision <= handledOpenRulesRevisionRef.current) return;
    handledOpenRulesRevisionRef.current = revision;
    setProjectRulesEdited(false);
    void capability.commands.openRules();
  }, [capability, panelSnapshot.openRulesRevision]);

  useLayoutEffect(() => {
    const request = panelSnapshot.editorRestoreRequest;
    if (!request) return undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const editor = projectRulesEditorRef.current;
        panelPort.settleEditorRestore(request.requestId);
        editor?.focus({ preventScroll: true });
        editor?.setSelectionRange(editor.value.length, editor.value.length);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [panelPort, panelSnapshot.editorRestoreRequest]);

  const toggleProjectRules = useCallback(async () => {
    setProjectRulesEdited(false);
    if (rules.open) {
      await capability.commands.closeRules();
      return;
    }
    await capability.commands.openRules();
  }, [capability, rules.open]);

  const projectRulesSavedNotice = projectRulesEdited
    && rules.open
    && !rules.saving
    && !rules.saveError
    && rules.content === rules.savedContent;

  const displayedVersions = useMemo(() => {
    const current = versions.find(
      (version) => version.id === versionSnapshot.currentBasedOnVersionId,
    ) || null;
    if (!current) return versions;
    const presentation = currentWorkingCopyPresentation({
      currentBasedOnVersionId: versionSnapshot.currentBasedOnVersionId,
      currentExactVersionId: versionSnapshot.currentExactVersionId,
      persistState: context.persistState,
      persistedDiffersFromBase: current.differsFromBase === true,
      persistedSaveState: current.saveState,
    });
    return versions.map((version) => (
      version.id === current.id
        ? { ...version, ...presentation }
        : version
    ));
  }, [context.persistState, versionSnapshot, versions]);
  const consoleVersion = displayedVersions.find(
    (version) => version.id === selectedVersionId,
  ) ?? displayedVersions.find(
    (version) => version.id === versionSnapshot.currentBasedOnVersionId,
  ) ?? displayedVersions[0] ?? null;
  const consoleVersionParentId = consoleVersion
    ? consoleVersion.basedOnVersionId || consoleVersion.previousVersionId
    : null;
  const consoleVersionParent = consoleVersionParentId
    ? displayedVersions.find((version) => version.id === consoleVersionParentId) ?? null
    : null;

  return (
    <>
      <ProjectFilesHeader
        projectName={context.projectName}
        browserPreviewOnly={context.browserPreviewOnly}
        saveStatusLabel={context.saveStatusLabel}
        versions={versions}
        canShowCurrentFileInFolder={context.canShowCurrentFileInFolder}
        onShowInFolder={actions.onShowInFolder}
        onExport={actions.onExport}
        onClose={actions.onClose}
      />
      <div className="drawer-body">
        <ProjectFilesConsole
          projectRulesOpen={rules.open}
          projectId={projectId}
          projectRecordsPreparing={context.projectRecordsPreparing}
          projectRecordsError={context.projectRecordsError}
          projectRulesSavedNotice={projectRulesSavedNotice}
          activeFileView={activeFileView}
          runInProgress={context.runInProgress}
          projectRulesEditorGeneration={rules.editorGeneration}
          projectRulesEditorRef={projectRulesEditorRef}
          projectRulesSaveError={rules.saveError}
          projectRulesSaving={rules.saving}
          projectRulesCompositionActive={rules.compositionActive}
          versions={versions}
          displayedVersions={displayedVersions}
          consoleVersion={consoleVersion}
          currentBasedOnVersionId={versionSnapshot.currentBasedOnVersionId}
          consoleVersionParent={consoleVersionParent}
          latestVersionId={versionSnapshot.latestVersionId}
          viewingVersionId={versionSnapshot.viewingVersionId}
          attachmentObjectUrls={context.attachmentObjectUrls}
          toggleProjectRules={toggleProjectRules}
          prepareProjectRecords={actions.prepareProjectRecords}
          viewFile={() => {
            void capability.commands.openRules();
          }}
          beginProjectRulesComposition={(target) => {
            capability.commands.beginRulesComposition(target, target.value);
          }}
          finishProjectRulesComposition={(target) => {
            capability.commands.finishRulesComposition(target);
          }}
          onProjectRulesChange={(content) => {
            setProjectRulesEdited(true);
            capability.commands.updateRules(content);
          }}
          restoreProjectRules={() => {
            capability.commands.restoreRules();
          }}
          saveProjectRules={async () => (
            (await capability.commands.saveRules()).status === "succeeded"
          )}
          setSelectedVersionId={setSelectedVersionId}
          ensureAttachmentObjectUrl={actions.ensureAttachmentObjectUrl}
          openAttachmentPreview={actions.openAttachmentPreview}
          downloadAttachment={actions.downloadAttachment}
        />
      </div>
      <ProjectFilesFooter
        consoleVersion={consoleVersion}
        runInProgress={context.runInProgress}
        projectHydrating={context.projectHydrating}
        projectLoadError={context.projectLoadError}
        workspaceIssue={context.workspaceIssue}
        viewTransitioning={context.viewTransitioning}
        viewHistoryVersion={actions.viewHistoryVersion}
      />
    </>
  );
});

export const WorkbenchGlobalSidebarContainer = memo(function WorkbenchGlobalSidebarContainer({
  capability,
  ...props
}: {
  capability: ProjectCatalogCapability;
  open: boolean;
  onToggle(): void;
  onOpenLocal(): void;
  onOpenRecent(sourcePath: string): void;
  onOpenRegistered(project: RegisteredProject): void;
  onOpenCurrentProject(): void;
  updateActionVisible: boolean;
  updateDownloaded: boolean;
  updateDownloading: boolean;
  updateResult: ApplicationUpdateResult | null | undefined;
  updateBadgeLabel: string;
  onOpenAbout(): void;
  onDownloadOrRestartUpdate(): void;
}) {
  const catalog = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  return (
    <WorkbenchGlobalSidebar
      {...props}
      recentProjects={[...catalog.recent]}
      registeredProjects={[...catalog.registered]}
      projectsError={catalog.error}
      onToggle={() => {
        props.onToggle();
        if (!props.open) {
          void capability.commands.refreshRecents();
          void capability.commands.refreshRegistered();
        }
      }}
    />
  );
});

export const WorkbenchStartPageContainer = memo(function WorkbenchStartPageContainer({
  capability,
  activeTabId,
  onOpenLocal,
  onOpenRecent,
  onOpenSidebar,
}: {
  capability: ProjectCatalogCapability;
  activeTabId: string;
  onOpenLocal(): void;
  onOpenRecent(sourcePath: string): void;
  onOpenSidebar(): void;
}) {
  const catalog = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  return (
    <WorkbenchStartPage
      activeTabId={activeTabId}
      recentProjects={[...catalog.recent]}
      onOpenLocal={onOpenLocal}
      onOpenRecent={onOpenRecent}
      onOpenSidebar={() => {
        onOpenSidebar();
        void capability.commands.refreshRegistered();
      }}
    />
  );
});
