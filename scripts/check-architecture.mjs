#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const RETIRED_V1_MODULES = new Set([
  "app/components/NativeEditingController.ts",
  "app/lib/format-skeleton.js",
  "app/lib/native-block-edit-draft.js",
  "app/lib/native-edit-transaction.js",
  "app/lib/native-input-intent.js",
  "app/lib/native-structural-edit-planner.js",
]);
const RETIRED_V1_IMPORT =
  /(?:^|\/)(?:NativeEditingController|format-skeleton|native-block-edit-draft|native-edit-transaction|native-input-intent|native-structural-edit-planner)(?:\.[^/]+)?$/;
const RETIRED_SOURCE_PATCH_OPERATIONS =
  /\b(?:replace-text|replace-text-range|replace-text-flow-range|delete-hard-break|split-text-block|planTextPatch|planTextRangePatch|planTextFlowRangePatch|planDeleteHardBreakPatch|planSplitTextBlockPatch|textRangeToSourceEdit)\b/;
const LEGACY_RENDERER_STATE =
  /["'](?:waiting|importing|result-ready|awaiting-check-decision|version-created|completed|canceled|waived)["']/;
const RETIRED_WORKBENCH_RUN_AUTHORITIES =
  /\b(?:backgroundRunsRef|backgroundProjectResultsRef|qoderHandoffStatesRef|activeRunRef|activatingRunsRef|cancellingRunsRef|resolvingRunsRef|statusPollBusyRef)\b/;
const RETIRED_WORKBENCH_VERSION_WRITERS =
  /\b(?:setVersions|setLatestVersionId|setCurrentBasedOnVersionId|setCurrentExactVersionId|setRestoredFromVersionId|setViewMode|setViewingVersionId)\b/;
const RETIRED_WORKBENCH_DOCUMENT_AUTHORITIES =
  /\b(?:htmlRef|sourceShaRef|editRevisionRef|lastPersistedRevisionRef|persistStateRef|pendingWriteRef|flushPromiseRef)\b/;
const RETIRED_WORKBENCH_COMMENT_AUTHORITIES =
  /\b(?:commentsRef|changeEventsRef|deletedCommentIdsRef|composerDraftRef|composerCommentIdRef|composerAttachmentsRef|draftTargetRef|commentEditSessionRef)\b/;
const RETIRED_WORKBENCH_COMMENT_WORKFLOW_OWNERS =
  /\b(?:handleDraftSessionEvent|flushDraftPersistence|persistDraftRecovery|persistCurrentDraftRecovery|attachmentUploadCountRef|draftRecoveryOperationIdRef|deleteAttachmentFile)\b/;
// PR-6 closes the final View-to-Bridge migration budget. PR-7 removes this
// transitional accounting shape altogether and forbids the client import too.
const WORKBENCH_BRIDGE_CALL_ALLOWLIST = new Map();
const WORKBENCH_BRIDGE_CALL_LIMIT = 0;
const RETIRED_WORKBENCH_PROJECT_WORKFLOW_OWNERS =
  /\b(?:drainCoordinatorRef|externalFileOpenSessionRef|projectApplicationSessionRef|projectHydratingRef|projectLoadErrorRef|pendingProjectOpenRef|closeLifecycleRef|projectOpenRequestRef|applyProject|prepareProjectSwitch|applyAcceptedProject|enqueueAcceptedProject|openExternalProject)\b/;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ? [absolutePath]
      : [];
  }));
  return nested.flat();
}

function relative(filePath) {
  return path.relative(PRODUCT_ROOT, filePath).split(path.sep).join("/");
}

function importedSpecifiers(source) {
  return [
    ...source.matchAll(
      /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

function includesInOrder(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    if (next < 0) return false;
    cursor = next;
  }
  return true;
}

export async function architectureViolations() {
  const files = await sourceFiles(path.join(PRODUCT_ROOT, "app"));
  const violations = [];
  for (const filePath of files) {
    const file = relative(filePath);
    const source = await readFile(filePath, "utf8");
    if (RETIRED_V1_MODULES.has(file)) {
      violations.push(`${file}: retired V1 editing modules cannot return to production`);
    }
    if (RETIRED_SOURCE_PATCH_OPERATIONS.test(source)) {
      violations.push(`${file}: retired V1 source patch operations cannot return to production`);
    }
    if (
      /\bfetch\s*\(/.test(source)
      && file !== "app/application/bridge-client.js"
    ) {
      violations.push(`${file}: raw fetch belongs to bridge-client`);
    }
    if (
      /\b(?:localStorage|sessionStorage)\b/.test(source)
      && file !== "app/application/recovery-store.js"
      && file !== "app/components/HtmlInteractionPreview.tsx"
    ) {
      violations.push(`${file}: browser persistence belongs to recovery-store`);
    }
    if (
      /BRIDGE_URL|127\.0\.0\.1:\$\{?bridgePort|["'`]\/(?:workspace|draft|autosave|request|attachment|status|source|version-file|project-file)["'`]/.test(
        source,
      )
      && file !== "app/application/bridge-client.js"
    ) {
      violations.push(`${file}: Bridge endpoint knowledge belongs to bridge-client`);
    }
    if (
      LEGACY_RENDERER_STATE.test(source)
      && file !== "app/domain/run-lifecycle.js"
    ) {
      violations.push(`${file}: legacy lifecycle aliases belong to run-lifecycle`);
    }
    if (
      /(?:bridgeClient|this\.\#bridgeClient)\.saveDraft\s*\(/.test(source)
      && file !== "app/application/draft-session.js"
    ) {
      violations.push(`${file}: draft mutations belong to DraftSession`);
    }

    const imports = importedSpecifiers(source);
    for (const specifier of imports) {
      if (RETIRED_V1_IMPORT.test(specifier)) {
        violations.push(`${file}: production code cannot import retired V1 module ${specifier}`);
      }
    }
    if (file.startsWith("app/domain/")) {
      for (const specifier of imports) {
        if (
          /(?:^|\/)(?:application|components|desktop)(?:\/|$)/.test(specifier)
          || specifier === "react"
        ) {
          violations.push(`${file}: domain code cannot import ${specifier}`);
        }
      }
    }
    if (file.startsWith("app/application/")) {
      for (const specifier of imports) {
        if (/(?:^|\/)(?:components|desktop)(?:\/|$)/.test(specifier)) {
          violations.push(`${file}: application code cannot import ${specifier}`);
        }
      }
    }
    if (
      file === "app/application/workspace-controller.js"
      || file === "app/application/workspace-controller-codecs.js"
    ) {
      for (const specifier of imports) {
        if (
          specifier === "react"
          || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/.test(specifier)
        ) {
          violations.push(
            `${file}: WorkspaceController cannot import presentation or desktop code ${specifier}`,
          );
        }
      }
    }
    if (file.startsWith("app/components/")) {
      for (const specifier of imports) {
        if (/(?:^|\/)application(?:\/|$)/.test(specifier)) {
          violations.push(`${file}: view components cannot import application services`);
        }
      }
    }
    if (
      file === "app/workbench/presentation.tsx"
      || /^app\/workbench\/.*-view\.tsx$/.test(file)
    ) {
      for (const specifier of imports) {
        if (/(?:^|\/)application(?:\/|$)/.test(specifier)) {
          violations.push(
            `${file}: Workbench presentation components cannot import application services`,
          );
        }
      }
    }
  }

  const scriptFiles = await sourceFiles(path.join(PRODUCT_ROOT, "scripts"));
  for (const filePath of scriptFiles) {
    const file = relative(filePath);
    const source = await readFile(filePath, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      if (
        /(?:^|\/)app\/(?:application|components)(?:\/|$)/.test(specifier)
        || /(?:^|\/)app\/workbench(?:\.|\/|$)/.test(specifier)
      ) {
        violations.push(`${file}: Bridge and build scripts cannot import renderer code`);
      }
    }
    if (
      /DRAFT_REVISION_CONFLICT|INVALID_DRAFT_OPERATION_ID|INVALID_DELETED_COMMENT_ID/.test(
        source,
      )
      && ![
        "scripts/draft-service.mjs",
        "scripts/check-architecture.mjs",
      ].includes(file)
    ) {
      violations.push(`${file}: draft command policy belongs to draft-service`);
    }
  }

  const workspaceBridge = await readFile(
    path.join(PRODUCT_ROOT, "scripts", "workspace-bridge.mjs"),
    "utf8",
  );
  const sourceTransactionService = await readFile(
    path.join(PRODUCT_ROOT, "scripts", "source-transaction-service.mjs"),
    "utf8",
  );
  if (
    !workspaceBridge.includes('from "./source-transaction-service.mjs"')
    || !workspaceBridge.includes("commitSourceTransaction(")
    || !workspaceBridge.includes("recoverPendingSourceTransaction(")
  ) {
    violations.push(
      "scripts/workspace-bridge.mjs: autosave and source-history routes must delegate to SourceTransaction",
    );
  }
  if (
    /async function atomicReplaceSource\b/.test(workspaceBridge)
    || /\bwriteSourceHistory\s*\(/.test(workspaceBridge)
  ) {
    violations.push(
      "scripts/workspace-bridge.mjs: current-source writer belongs to source-transaction-service",
    );
  }
  if (
    !sourceTransactionService.includes("export async function commitSourceTransaction")
    || !sourceTransactionService.includes(
      "export async function recoverPendingSourceTransaction",
    )
    || !/async function atomicReplaceSource\b/.test(sourceTransactionService)
    || !/\bwriteSourceHistory\s*\(/.test(sourceTransactionService)
  ) {
    violations.push(
      "scripts/source-transaction-service.mjs: SourceTransaction must own commit, recovery, and source-history application",
    );
  }

  const workbench = await readFile(
    path.join(PRODUCT_ROOT, "app", "workbench.tsx"),
    "utf8",
  );
  const canvasEditor = await readFile(
    path.join(PRODUCT_ROOT, "app", "components", "HtmlCanvasEditor.tsx"),
    "utf8",
  );
  const projectSession = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "project-session.js",
    ),
    "utf8",
  );
  const workspaceController = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "workspace-controller.js",
    ),
    "utf8",
  );
  const projectWorkflow = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "project-workflow.js",
    ),
    "utf8",
  );
  const commentWorkflow = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "comment-workflow.js",
    ),
    "utf8",
  );
  const runWorkflow = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "run-workflow.js",
    ),
    "utf8",
  );
  const versionWorkflow = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "version-workflow.js",
    ),
    "utf8",
  );
  if (
    !workspaceController.includes("export class WorkspaceController")
    || !workspaceController.includes("ensureRegistered({")
    || !workspaceController.includes("#registrationPromise")
    || !workspaceController.includes("this.#projectSession.register({")
    || !workspaceController.includes("this.#draftSession.replaceAuthority(")
    || !workspaceController.includes("this.#sourceHistorySession.activate(")
    || !workspaceController.includes("return stale(identity)")
    || /\bnew\s+(?:ProjectSession|DocumentSession|CommentSession|DraftSession|VersionSession|SourceHistorySession)\b/.test(
      workspaceController,
    )
  ) {
    violations.push(
      "app/application/workspace-controller.js: registration must own the injected Session transition, single-flight, and stale fence",
    );
  }
  if (
    /\bensureProjectRegistered\b|\bprojectRegistrationPromiseRef\b/.test(workbench)
    || !workbench.includes("new WorkspaceController({")
    || !workbench.includes(
      "requiredWorkspaceController(workspaceController).ensureRegistered(",
    )
    || /workspaceController\.getSnapshot\(\)\.registration\.phase\s*===\s*"registering"/.test(
      workbench,
    )
  ) {
    violations.push(
      "app/workbench.tsx: project registration must delegate to WorkspaceController without blocking a newer locator",
    );
  }
  if (
    !workspaceController.includes("#drainCoordinator = new DrainCoordinator()")
    || !workspaceController.includes("this.#projectWorkflow = new ProjectWorkflow({")
    || !workspaceController.includes("new ExternalFileOpenSession()")
    || !workspaceController.includes("new ProjectApplicationSession()")
    || !workspaceController.includes("prepareClose(input)")
    || !workspaceController.includes("readProjectFile(input)")
    || !workspaceController.includes("openProjectRecords(input)")
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-3 must own one DrainCoordinator and compose the project transition workflow",
    );
  }
  if (
    !projectWorkflow.includes("export class ProjectWorkflow")
    || !projectWorkflow.includes("async prepareSwitch(")
    || !projectWorkflow.includes("acceptProject(project,")
    || !projectWorkflow.includes("async openProject(")
    || !projectWorkflow.includes("async prepareClose(")
    || !projectWorkflow.includes("abortClose(")
    || !projectWorkflow.includes("#hydrationGeneration")
    || !projectWorkflow.includes("#projectApplicationSession.enqueue({")
    || !projectWorkflow.includes("this.#projectSession.openLocator(")
    || !projectWorkflow.includes("this.#documentSession.publishAuthority({")
    || !projectWorkflow.includes("this.#versionSession.hydrate({")
    || !projectWorkflow.includes("this.#canvasPort.invalidateRenderAcks?.()")
    || !projectWorkflow.includes("this.#bridgeClient.projectFile(")
    || !projectWorkflow.includes("this.#bridgeClient.openFolder(")
  ) {
    violations.push(
      "app/application/project-workflow.js: hydration, accepted FIFO, switch, close and project resources must share one typed workflow boundary",
    );
  }
  if (
    RETIRED_WORKBENCH_PROJECT_WORKFLOW_OWNERS.test(workbench)
    || !workbench.includes("projectWorkflow: {")
    || !workbench.includes("detail.waitUntil(workspaceController.prepareClose({")
    || !workbench.includes("workspaceController.acceptExternalProject(request)")
    || !workbench.includes("workspaceController.acceptBrowserProject({")
    || !workbench.includes(".readProjectFile({ context, relativePath })")
    || !workbench.includes(".openProjectRecords({ context })")
  ) {
    violations.push(
      "app/workbench.tsx: PR-3 project hydration, open, switch and close must be Controller commands with presentation-only host adapters",
    );
  }
  const bridgeCalls = [...workbench.matchAll(
    /\bbridgeClient\.([A-Za-z0-9_]+)\s*\(/g,
  )].map((match) => match[1]);
  const bridgeCallCounts = new Map();
  for (const method of bridgeCalls) {
    bridgeCallCounts.set(method, (bridgeCallCounts.get(method) || 0) + 1);
    if (!WORKBENCH_BRIDGE_CALL_ALLOWLIST.has(method)) {
      violations.push(
        `app/workbench.tsx: Bridge call ${method} is outside the PR-6 migration allowlist`,
      );
    }
  }
  if (bridgeCalls.length > WORKBENCH_BRIDGE_CALL_LIMIT) {
    violations.push(
      `app/workbench.tsx: PR-6 allows at most ${WORKBENCH_BRIDGE_CALL_LIMIT} direct Bridge calls`,
    );
  }
  for (const [method, limit] of WORKBENCH_BRIDGE_CALL_ALLOWLIST) {
    if ((bridgeCallCounts.get(method) || 0) > limit) {
      violations.push(
        `app/workbench.tsx: Bridge call ${method} exceeds its PR-6 migration allowance of ${limit}`,
      );
    }
  }
  if (
    !workbench.includes("documentWorkflow: {")
    || !workbench.includes(".enqueueDocumentEdit({")
    || !workbench.includes(".flushDocument({ throughRevision })")
    || !workbench.includes(".performDocumentHistoryAction({ direction, context })")
    || !workbench.includes(".reloadDocumentAuthority({")
    || !projectWorkflow.includes("this.#documentWorkflow.reconcileBoundary({")
    || /\b(?:autosaveTimerRef|auditPendingRef|auditInFlightKeysRef|historyActionPromiseRef|recoveryIdentityRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PR-2 document persistence, recovery and source history must delegate to WorkspaceController",
    );
  }
  if (
    !projectSession.includes(
      "if (!this.#sourcePath || !this.#projectId || !this.#documentId) return null;",
    )
    || !workbench.includes("return projectSessionRef.current.context;")
  ) {
    violations.push(
      "app/application/project-session.js: registered contexts cannot contain empty identities",
    );
  }
  if (
    !workbench.includes("resolveRuntimeCapabilities({")
    || !workbench.includes(
      'runtimeCapabilitiesRef.current.sourceEditing !== "enabled"',
    )
    || !workbench.includes(
      "mode: () => runtimeCapabilitiesRef.current.projectOpening",
    )
    || !workbench.includes(
      "runtimeCapabilitiesRef.current.attachmentPersistence",
    )
    || !workbench.includes(
      'runtimeCapabilitiesRef.current.closeCoordination',
    )
  ) {
    violations.push(
      "app/workbench.tsx: runtime features must use the central capability manifest",
    );
  }
  if (/const previewOnly = !window\.htmlAIProjects/.test(workbench)) {
    violations.push(
      "app/workbench.tsx: project IPC presence cannot own renderer edit capability",
    );
  }
  if (
    !workbench.includes("const runSessionRef = useRef(new RunSession(")
    || RETIRED_WORKBENCH_RUN_AUTHORITIES.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: AI run state and operation locks belong to RunSession",
    );
  }
  if (
    !workbench.includes(
      "const versionSessionRef = useRef(new VersionSession<Version>());",
    )
    || RETIRED_WORKBENCH_VERSION_WRITERS.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: Version authority and history view transitions belong to VersionSession",
    );
  }
  if (
    !workbench.includes(
      "const documentSessionRef = useRef(new DocumentSession<PendingWrite>({",
    )
    || RETIRED_WORKBENCH_DOCUMENT_AUTHORITIES.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: source bytes, revisions and write state belong to DocumentSession",
    );
  }
  if (
    !workbench.includes("const commentSessionRef = useRef(new CommentSession<")
    || RETIRED_WORKBENCH_COMMENT_AUTHORITIES.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: comment working-copy state belongs to CommentSession",
    );
  }
  if (
    RETIRED_WORKBENCH_COMMENT_WORKFLOW_OWNERS.test(workbench)
    || /\bbridgeClient\.(?:attachment|saveAttachment|deleteAttachment)\s*\(/.test(workbench)
    || !workbench.includes("commentWorkflow: {")
    || !workbench.includes(".commitComment({ commentId })")
    || !workbench.includes(".uploadAttachments({")
    || !workbench.includes(".flushDraft()")
  ) {
    violations.push(
      "app/workbench.tsx: PR-4 comment persistence and attachment IO must delegate to CommentWorkflow",
    );
  }
  if (
    !workspaceController.includes("import { CommentWorkflow }")
    || !workspaceController.includes("this.#commentWorkflow = new CommentWorkflow({")
    || !workspaceController.includes("comment: this.#commentWorkflow?.getSnapshot() || null")
    || !workspaceController.includes("commitComment(input)")
    || !workspaceController.includes("uploadAttachments(input)")
    || !workspaceController.includes("flushDraft(input)")
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-4 must compose and expose CommentWorkflow commands and projection",
    );
  }
  if (
    !workspaceController.includes("import { RunWorkflow }")
    || !workspaceController.includes("this.#runWorkflow = new RunWorkflow({")
    || !workspaceController.includes("run: this.#runSnapshot")
    || !workspaceController.includes("submitRequest(input)")
    || !workspaceController.includes("cancelRun(input)")
    || !workspaceController.includes("resolveRunConflict(input)")
    || !workspaceController.includes("this.#runWorkflow?.dispose()")
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-5 must compose RunWorkflow, expose commands, project its snapshot, and dispose its poller",
    );
  }
  if (
    !runWorkflow.includes("export class RunWorkflow")
    || !runWorkflow.includes("async submit({")
    || !runWorkflow.includes("async reconcileSubmission({")
    || !runWorkflow.includes("async pollNow({")
    || !runWorkflow.includes("async cancel({")
    || !runWorkflow.includes("async resolveConflict({")
    || !runWorkflow.includes("this.#bridgeClient.createRequest(request)")
    || !runWorkflow.includes("this.#bridgeClient.workspace(entry.context.sourcePath)")
    || !runWorkflow.includes("this.#bridgeClient.status(")
    || !runWorkflow.includes("this.#bridgeClient.cancelActiveRun({")
    || !runWorkflow.includes("this.#bridgeClient.resolveConflict({")
    || !runWorkflow.includes("this.#runSession.markSubmissionUncertain(submission)")
    || !runWorkflow.includes("this.#runSession.hasRun(run)")
    || !runWorkflow.includes("#pollGeneration")
    || !runWorkflow.includes("stopPolling()")
    || !runWorkflow.includes("this.#handoffPort.copy({")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(runWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/run-workflow.js: Request, read-only reconciliation, fenced polling, cancellation, conflict resolution, and handoff confirmation must stay in the application boundary",
    );
  }
  if (
    !workbench.includes("runWorkflow: {")
    || !workbench.includes(".submitRequest({")
    || !workbench.includes(".copyRunHandoff({ run: activeRun })")
    || !workbench.includes(".cancelRun({")
    || !workbench.includes(".resolveRunConflict({ run: activeRun, action })")
    || /\bbridgeClient\.(?:workspace|createRequest|status|cancelActiveRun|resolveConflict)\s*\(/.test(workbench)
    || /\b(?:processRunStatus|reconcilePendingRun|sendToQoderWork|hydrateRecentProjectRuns)\b/.test(workbench)
    || /const\s+timer\s*=\s*window\.setInterval\(/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PR-5 Run commands and timer lifecycle must delegate to WorkspaceController/RunWorkflow; Workbench keeps only host adapters and presentation",
    );
  }
  if (
    !commentWorkflow.includes("export class CommentWorkflow")
    || !commentWorkflow.includes("#uploadCount")
    || !commentWorkflow.includes("#recoveryOperationId")
    || !commentWorkflow.includes("this.#draftSession.setObserver(")
    || !commentWorkflow.includes("async uploadAttachments(")
    || !commentWorkflow.includes("async deleteAttachment(")
    || !commentWorkflow.includes("async flushDraft(")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/.test(
      importedSpecifiers(commentWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/comment-workflow.js: Draft recovery, upload compensation, and durable attachment commands must stay in the application boundary",
    );
  }
  if (
    !projectWorkflow.includes("this.#commentWorkflow.inspectAttachment()")
    || !projectWorkflow.includes("this.#commentWorkflow.drainDraft({")
  ) {
    violations.push(
      "app/application/project-workflow.js: PR-4 drain obligations must delegate to CommentWorkflow",
    );
  }
  for (const boundary of ["close", "switch"]) {
    if (!new RegExp(`\\.drain\\("${boundary}"`).test(projectWorkflow)) {
      violations.push(
        `app/application/project-workflow.js: ${boundary} must use the Controller DrainCoordinator`,
      );
    }
  }
  if (
    !versionWorkflow.includes('this.#projectWorkflow.drain("history"')
    || !workbench.includes(".viewHistory({ version, context")
  ) {
    violations.push(
      "app/application/version-workflow.js: history must delegate to the Controller DrainCoordinator",
    );
  }

  if (
    !workspaceController.includes("import { VersionWorkflow }")
    || !workspaceController.includes("this.#versionWorkflow = new VersionWorkflow({")
    || !workspaceController.includes("version: this.#versionSnapshot")
    || !workspaceController.includes("prepareReviewCandidate(input)")
    || !workspaceController.includes("activateReadyVersion(input)")
    || !workspaceController.includes("viewHistory(input)")
    || !workspaceController.includes("returnToCurrent(input)")
    || !workspaceController.includes("this.#versionWorkflow?.dispose()")
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-6 must compose VersionWorkflow, expose its commands, project navigation state and dispose it",
    );
  }
  if (
    !versionWorkflow.includes("export class VersionWorkflow")
    || !versionWorkflow.includes("async prepareReviewCandidate({ run }")
    || !versionWorkflow.includes("async activateReadyVersion({")
    || !versionWorkflow.includes("async openCommittedVersion({")
    || !versionWorkflow.includes("async viewHistory({")
    || !versionWorkflow.includes("async returnToCurrent({")
    || !versionWorkflow.includes("this.#bridgeClient.versionFile(")
    || !versionWorkflow.includes("this.#bridgeClient.source(")
    || !versionWorkflow.includes("this.#bridgeClient.activateReadyVersion({")
    || !versionWorkflow.includes("this.#projectWorkflow.commitGeneratedSourceTransition({")
    || !versionWorkflow.includes("#rollbackNavigation(operation, previous)")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(versionWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/version-workflow.js: Version validation, activation, immutable review preparation and rollback navigation must stay in the application boundary",
    );
  }
  if (
    !projectWorkflow.includes("async prepareGeneratedSourceTransition({")
    || !projectWorkflow.includes("commitGeneratedSourceTransition({ prepared, html, sourceSha256, publishVersion })")
  ) {
    violations.push(
      "app/application/project-workflow.js: PR-6 Version activation must reuse the synchronous generated-source publication API",
    );
  }
  if (
    bridgeCalls.length !== 0
    || !workbench.includes("versionWorkflow: {")
    || !workbench.includes(".prepareReviewCandidate({ run })")
    || !workbench.includes(".activateReadyVersion({")
    || !workbench.includes(".viewHistory({ version, context")
    || !workbench.includes(".returnToCurrent({ context })")
    || /\b(?:openCommittedVersion|prepareGeneratedSourceTransition|commitGeneratedSourceTransition|navigationOperationRef|viewTransitioningRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PR-6 Version IO and navigation ownership must delegate to WorkspaceController; Workbench keeps only review presentation and outcome mapping",
    );
  }

  const sourcePatchBoundary = sourceSection(
    canvasEditor,
    "const applySourceCommand = useCallback",
    "const clearNativeEditCheckpointTimer",
  );
  if (
    !includesInOrder(sourcePatchBoundary, [
      "planSourcePatch(command, sourceIndex)",
      "applyPatchPlan(",
      "const sourceTransaction: HtmlCanvasSourceTransaction",
      "onChangeRef.current(",
      "result.html",
      "sourceTransaction",
    ])
    || /\b(?:serializeDocument|getSerializedHtml)\b|\.innerHTML\b|onChangeRef\.current\([^)]*outerHTML/su.test(
      canvasEditor,
    )
  ) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: source edits must publish SourcePatch bytes plus their SourceTransaction and must never serialize preview DOM",
    );
  }

  const nativeCommandBoundary = sourceSection(
    canvasEditor,
    "const deferNativeCommand = useCallback",
    "deferNativeCommandRef.current = deferNativeCommand",
  );
  if (!includesInOrder(nativeCommandBoundary, [
    "const incumbent = pendingNativeCommandCallbackRef.current",
    "?? scheduledNativeCommandCallbackRef.current",
    "authority === \"system\" && incumbent?.authority === \"user-explicit\"",
    "options.onDiscard?.(\"blocked-by-user-command\")",
    "return true",
    "active.session.queuePendingCommand",
  ])) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: native command arbitration must reject lower-priority system work before the controller queue",
    );
  }

  const canonicalReplacementBoundary = sourceSection(
    canvasEditor,
    "restartCanonicalNativeEditRef.current = (",
    "const moveSelected = useCallback",
  );
  if (!includesInOrder(canonicalReplacementBoundary, [
    "currentNativeEditLeaseRef.current = null",
    "activeNativeEditRef.current = null",
    "discardPendingNativeCommands(\"session-ended\")",
    "active.session.fenceDispose()",
    "nativeDomGenerationRef.current += 1",
    "parentNode.replaceChild(nextRoot, active.rootElement)",
  ])) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: canonical host replacement must retire the native lease before removing the authored DOM host",
    );
  }

  const sourceFreezeBoundary = sourceSection(
    workbench,
    "const fenceAndFreezeCurrentCanvas = useCallback",
    "const fileInputRef",
  );
  if (!includesInOrder(sourceFreezeBoundary, [
    "const editor = editorRef.current",
    "if (!editor)",
    "const frozen = editor.freezeNow()",
    "if (!frozen.ok)",
    "editor.getSourceHtml() !== frozen.html",
    "return { ...frozen, ok: true",
  ])) {
    violations.push(
      "app/workbench.tsx: source transitions must fail closed unless Canvas freezes the exact current source bytes",
    );
  }

  const createRequestPayload = sourceSection(
    runWorkflow,
    "const request = {",
    "const operationId = this.#codecs.operationKey(pendingRun)",
  );
  if (
    !includesInOrder(runWorkflow, [
      "const frozen = this.#canvasPort.freeze(",
      "const frozenHash = await this.#hashPort.sha256",
      "const persistedSourceSha256 = this.#documentSession.sourceSha256",
      "persistedSourceSha256 !== frozen.sourceSha256",
      "expectedSourceSha256: persistedSourceSha256",
      "this.#bridgeClient.createRequest(request)",
    ])
    || !createRequestPayload
    || /\b(?:html|baseHtml|projection)\s*:/u.test(createRequestPayload)
    || /EditRuntimeSnapshotSession|runtimeVisualProjection|runtimeVisualViewport|htmlAIRuntimeSnapshots|data-pageroot-readonly-visual/u.test(
      workbench,
    )
  ) {
    violations.push(
      "app/application/run-workflow.js: AI requests must bind the exact frozen persisted source and Edit must not own a runtime projection",
    );
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await architectureViolations();
  if (violations.length > 0) {
    process.stderr.write(`Architecture contract failed:\n- ${violations.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Architecture contract passed.\n");
  }
}
