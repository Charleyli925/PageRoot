"use client";

import type { RefObject } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ExportIcon } from "@phosphor-icons/react/dist/csr/Export";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { TriangleIcon } from "@phosphor-icons/react/dist/csr/Triangle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import { VersionDetail, VersionTreeList } from "./presentation";
import { workspaceFileLabel } from "./project-model";
import type {
  CommentAttachment,
  Version,
  WorkspaceFileView,
  WorkspaceIssue,
} from "./types";

export function ProjectFilesHeader({
  projectName,
  browserPreviewOnly,
  saveStatusLabel,
  versions,
  canShowCurrentFileInFolder,
  onShowInFolder,
  onExport,
  onClose,
}: {
  projectName: string;
  browserPreviewOnly: boolean;
  saveStatusLabel: string;
  versions: readonly Version[];
  canShowCurrentFileInFolder: boolean;
  onShowInFolder: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
          <header className="drawer-header project-panel-header">
            <div className="project-panel-title">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="./brand-logo.png" alt="" />
              <span>
                <strong>{projectName}</strong>
                <small className="project-panel-meta">
                  <span aria-hidden="true" />
                  {[
                    browserPreviewOnly ? "只读预览" : saveStatusLabel,
                    versions.length > 0 ? `${versions.length} 个版本` : null,
                  ].filter(Boolean).join(" · ")}
                </small>
              </span>
            </div>
            <div className="project-panel-actions">
              {canShowCurrentFileInFolder ? (
                <button
                  className="project-panel-action"
                  type="button"
                  onClick={() => void onShowInFolder()}
                >
                  <FolderOpenIcon aria-hidden="true" size={15} weight="duotone" />
                  在文件夹中打开
                </button>
              ) : null}
              <button
                className="project-panel-action"
                type="button"
                onClick={() => void onExport()}
              >
                <ExportIcon aria-hidden="true" size={15} weight="bold" />
                导出副本
              </button>
            </div>
            <button
              className="drawer-close-button"
              type="button"
              aria-label="关闭项目面板"
              title="关闭"
              onClick={onClose}
            >
              <XIcon aria-hidden="true" size={18} weight="bold" />
            </button>
          </header>
  );
}

export function ProjectFilesConsole({
  projectRulesOpen,
  projectId,
  projectRecordsPreparing,
  projectRecordsError,
  projectRulesSavedNotice,
  activeFileView,
  runInProgress,
  projectRulesEditorGeneration,
  projectRulesEditorRef,
  projectRulesSaveError,
  projectRulesSaving,
  projectRulesCompositionActive,
  versions,
  displayedVersions,
  consoleVersion,
  currentBasedOnVersionId,
  consoleVersionParent,
  latestVersionId,
  viewingVersionId,
  attachmentObjectUrls,
  toggleProjectRules,
  prepareProjectRecords,
  viewFile,
  beginProjectRulesComposition,
  finishProjectRulesComposition,
  onProjectRulesChange,
  restoreProjectRules,
  saveProjectRules,
  setSelectedVersionId,
  ensureAttachmentObjectUrl,
  openAttachmentPreview,
  downloadAttachment,
}: {
  projectRulesOpen: boolean;
  projectId: string | null | undefined;
  projectRecordsPreparing: boolean;
  projectRecordsError: string;
  projectRulesSavedNotice: boolean;
  activeFileView: WorkspaceFileView | null;
  runInProgress: boolean;
  projectRulesEditorGeneration: number;
  projectRulesEditorRef: RefObject<HTMLTextAreaElement | null>;
  projectRulesSaveError: string;
  projectRulesSaving: boolean;
  projectRulesCompositionActive: boolean;
  versions: readonly Version[];
  displayedVersions: readonly Version[];
  consoleVersion: Version | null | undefined;
  currentBasedOnVersionId: string | null;
  consoleVersionParent: Version | null | undefined;
  latestVersionId: string | null;
  viewingVersionId: string | null;
  attachmentObjectUrls: Record<string, string>;
  toggleProjectRules: () => void | Promise<void>;
  prepareProjectRecords: () => void | Promise<void>;
  viewFile: (path: string) => void | Promise<void>;
  beginProjectRulesComposition: (target: HTMLTextAreaElement) => void;
  finishProjectRulesComposition: (target: HTMLTextAreaElement) => void;
  onProjectRulesChange: (content: string) => void;
  restoreProjectRules: () => void;
  saveProjectRules: () => void | Promise<boolean | void>;
  setSelectedVersionId: (versionId: string) => void;
  ensureAttachmentObjectUrl: (
    attachment: CommentAttachment,
  ) => Promise<string>;
  openAttachmentPreview: (
    attachment: CommentAttachment,
  ) => void | Promise<void>;
  downloadAttachment: (
    attachment: CommentAttachment,
  ) => void | Promise<void>;
}) {
  return (
            <div className="project-console">
              <section
                className="project-rules-row"
                data-open={projectRulesOpen ? "true" : "false"}
              >
                <button
                  className="project-rules-summary"
                  type="button"
                  aria-expanded={projectRulesOpen}
                  disabled={
                    !projectId
                    || projectRecordsPreparing
                    || Boolean(projectRecordsError)
                  }
                  onClick={() => void toggleProjectRules()}
                >
                  <PencilSimpleIcon aria-hidden="true" size={15} weight="bold" />
                  <strong>项目规则</strong>
                  <small>每次 AI Agent 修改本项目 HTML 都会读取</small>
                  {projectRulesSavedNotice ? (
                    <em className="project-rules-saved" role="status">
                      <span aria-hidden="true" />
                      项目规则已保存
                    </em>
                  ) : null}
                  <CaretRightIcon aria-hidden="true" size={15} weight="bold" />
                </button>
                {projectRecordsError ? (
                  <section className="project-resource-error" role="alert">
                    <div>
                      <strong>项目规则还没有建立</strong>
                      <span>{projectRecordsError}</span>
                    </div>
                    <button
                      type="button"
                      disabled={projectRecordsPreparing}
                      onClick={() => void prepareProjectRecords()}
                    >{projectRecordsPreparing ? "正在重试…" : "重试建立"}</button>
                  </section>
                ) : null}
                {projectRulesOpen && activeFileView ? (
                  activeFileView.error ? (
                  <section className="project-file-read-error" role="alert">
                    <span className="project-resource-icon">
                      <TriangleIcon aria-hidden="true" size={20} weight="duotone" />
                    </span>
                    <div>
                      <small>{workspaceFileLabel(activeFileView.path)}</small>
                      <strong>内容没有读取成功</strong>
                      <p>{activeFileView.error}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void viewFile(activeFileView.path)}
                    >重试读取</button>
                  </section>
                  ) : (
                  <div className="project-rules-editor">
                    <p className="project-file-note" id="project-rules-help">
                      {activeFileView.loading
                        ? "正在读取项目规则。内容核对完成前暂不接受编辑。"
                        : runInProgress
                        ? "本轮已经使用冻结时的规则。AI 处理完成前这里保持只读，不会把临时修改追加入本轮。"
                        : "修改会自动保存。每次发送至 Qoder 时，源页都会把这份规则与本轮要求一起交接；规则只影响后续任务，不会修改当前 HTML。"}
                    </p>
                    <textarea
                      key={projectRulesEditorGeneration}
                      ref={projectRulesEditorRef}
                      className="project-file-editor"
                      aria-label="项目长期规则"
                      aria-describedby="project-rules-help"
                      spellCheck={false}
                      disabled={activeFileView.loading || runInProgress}
                      value={activeFileView.content}
                      onCompositionStart={(event) => {
                        beginProjectRulesComposition(event.currentTarget);
                      }}
                      onCompositionEnd={(event) => {
                        finishProjectRulesComposition(event.currentTarget);
                      }}
                      onChange={(event) => {
                        onProjectRulesChange(event.target.value);
                      }}
                    />
                    {projectRulesSaveError ? (
                      <p className="project-file-save-error" role="status">
                        {projectRulesSaveError}
                      </p>
                    ) : null}
                    <div className="project-file-actions">
                      <small>
                        {projectRulesSaving
                          ? "正在自动保存"
                          : activeFileView.content === activeFileView.savedContent
                          ? "当前内容已记录"
                          : "修改将在稍后自动保存"}
                      </small>
                      <button
                        type="button"
                        disabled={
                          activeFileView.loading
                          || projectRulesSaving
                          || runInProgress
                          || activeFileView.content === activeFileView.savedContent
                        }
                        onPointerDown={(event) => {
                          if (projectRulesCompositionActive) {
                            event.preventDefault();
                          }
                        }}
                        onMouseDown={(event) => {
                          if (projectRulesCompositionActive) {
                            event.preventDefault();
                          }
                        }}
                        onClick={restoreProjectRules}
                      >还原修改</button>
                      {projectRulesSaveError ? (
                        <button
                          className="drawer-primary"
                          type="button"
                          disabled={projectRulesSaving || runInProgress}
                          onClick={() => void saveProjectRules()}
                        >再次保存</button>
                      ) : null}
                    </div>
                  </div>
                  )
                ) : null}
              </section>
              <div className="project-console-body">
                <div className="version-tree-column">
                  <header className="version-tree-heading">
                    <strong>版本树</strong>
                    <span>{versions.length} 个</span>
                  </header>
                  {versions.length === 0 ? (
                    <p className="version-tree-empty">
                      首次编辑或发送给 AI 后，会建立版本 1。
                    </p>
                  ) : (
                    <VersionTreeList
                      versions={displayedVersions}
                      selectedVersionId={consoleVersion?.id ?? null}
                      editingBaseVersionId={currentBasedOnVersionId}
                      onSelect={setSelectedVersionId}
                    />
                  )}
                </div>
                <div className="version-detail-column">
                  {consoleVersion ? (
                    <VersionDetail
                      version={consoleVersion}
                      parent={consoleVersionParent ?? null}
                      latest={consoleVersion.id === latestVersionId}
                      editingBase={consoleVersion.id === currentBasedOnVersionId}
                      viewing={viewingVersionId === consoleVersion.id}
                      attachmentObjectUrls={attachmentObjectUrls}
                      onSelectParent={setSelectedVersionId}
                      onEnsureAttachmentPreview={ensureAttachmentObjectUrl}
                      onPreviewAttachment={(attachment) => {
                        void openAttachmentPreview(attachment);
                      }}
                      onDownloadAttachment={(attachment) => {
                        void downloadAttachment(attachment);
                      }}
                    />
                  ) : (
                    <p className="version-detail-placeholder">
                      还没有版本。开始编辑或发给 AI 后，这里会逐步长成一棵版本树。
                    </p>
                  )}
                </div>
              </div>
            </div>
  );
}

export function ProjectFilesFooter({
  consoleVersion,
  runInProgress,
  projectHydrating,
  projectLoadError,
  workspaceIssue,
  viewTransitioning,
  viewHistoryVersion,
}: {
  consoleVersion: Version | null | undefined;
  runInProgress: boolean;
  projectHydrating: boolean;
  projectLoadError: string | null | undefined;
  workspaceIssue: WorkspaceIssue | null | undefined;
  viewTransitioning: boolean;
  viewHistoryVersion: (version: Version) => void | Promise<void>;
}) {
  if (!consoleVersion) return null;
  return (
          <footer className="project-console-footer">
            <button
              className="project-console-primary"
              type="button"
              disabled={
                runInProgress
                || projectHydrating
                || Boolean(projectLoadError)
                || Boolean(workspaceIssue)
                || viewTransitioning
              }
              onClick={() => void viewHistoryVersion(consoleVersion)}
            >
              <EyeIcon aria-hidden="true" size={16} weight="bold" />
              在画布中预览
            </button>
          </footer>
  );
}
