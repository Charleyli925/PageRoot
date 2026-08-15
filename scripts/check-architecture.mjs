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
const RETIRED_WORKBENCH_MIGRATION_OWNERS =
  /\b(?:backgroundRunsRef|backgroundProjectResultsRef|qoderHandoffStatesRef|activeRunRef|activatingRunsRef|cancellingRunsRef|resolvingRunsRef|statusPollBusyRef|htmlRef|sourceShaRef|editRevisionRef|lastPersistedRevisionRef|persistStateRef|pendingWriteRef|flushPromiseRef|commentsRef|changeEventsRef|deletedCommentIdsRef|composerDraftRef|composerCommentIdRef|composerAttachmentsRef|draftTargetRef|commentEditSessionRef|handleDraftSessionEvent|flushDraftPersistence|persistDraftRecovery|persistCurrentDraftRecovery|attachmentUploadCountRef|draftRecoveryOperationIdRef|deleteAttachmentFile|drainCoordinatorRef|externalFileOpenSessionRef|projectApplicationSessionRef|projectHydratingRef|projectLoadErrorRef|pendingProjectOpenRef|closeLifecycleRef|projectOpenRequestRef|applyProject|prepareProjectSwitch|applyAcceptedProject|enqueueAcceptedProject|openExternalProject)\b/;
const RUNTIME_SESSION_CONSTRUCTORS = [
  "ProjectSession",
  "DocumentSession",
  "CommentSession",
  "DraftSession",
  "VersionSession",
  "SourceHistorySession",
  "RunSession",
  "ProjectRulesSession",
  "ExternalFileOpenSession",
  "ProjectApplicationSession",
  "EditAuthorRuntimeSession",
];

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

// PR-7 closes the composition boundary. These checks deliberately inspect
// responsibility-shaped code (imports, constructors, typed commands and drain
// calls), rather than preserving a temporary allowlist or matching line-level
// migration scaffolding.
export function compositionBoundaryViolations({
  workbench = "",
  workspaceController = "",
  projectWorkflow = "",
  runWorkflow = "",
  versionWorkflow = "",
  applicationSources = [],
} = {}) {
  const violations = [];
  const workbenchBridgeEscape = /(?:application\/bridge-client|\bcreateRuntimeBridgeClient\b|\bbridgeClient\s*\.)/u;
  if (workbenchBridgeEscape.test(workbench)) {
    violations.push(
      "app/workbench.tsx: View code cannot import or call the Bridge client",
    );
  }
  if (
    /\bnew\s+(?:ProjectSession|DocumentSession|CommentSession|DraftSession|VersionSession|SourceHistorySession|RunSession|ProjectRulesSession|ExternalFileOpenSession|ProjectApplicationSession)\b/u.test(workbench)
    || /\b(?:projectSessionRef|documentSessionRef|commentSessionRef|draftSessionRef|versionSessionRef|sourceHistorySessionRef|runSessionRef|projectRulesSessionRef)\b/u.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: Workbench cannot own runtime Session construction or refs",
    );
  }
  if (
    RETIRED_WORKBENCH_MIGRATION_OWNERS.test(workbench)
    || /\b(?:executeBridge|executeCommand|command)\s*\(/u.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: retired workflow owners and generic command escapes are forbidden",
    );
  }
  if (/\blegacy(?:Port)?\b/u.test(workbench)) {
    violations.push(
      "app/workbench.tsx: final composition cannot retain a legacy workflow adapter",
    );
  }
  if (
    !/\bcreateRuntimeWorkspaceController\s*\(/u.test(workbench)
    || !/\bworkspaceControllerRef\b/u.test(workbench)
    || !/\.subscribe\s*\(\s*setWorkspaceControllerSnapshot/u.test(workbench)
    || !/\.subscribeEvents\s*\(/u.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: Workbench must compose one runtime Controller and render its aggregate snapshot",
    );
  }

  const controllerBoundaryImports = importedSpecifiers(workspaceController);
  if (controllerBoundaryImports.some((specifier) => (
    specifier === "react"
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/u.test(specifier)
  ))) {
    violations.push(
      "app/application/workspace-controller.js: Controller cannot import React, presentation, or desktop code",
    );
  }
  if (/\b(?:executeBridge|executeCommand|command)\s*\(/u.test(workspaceController)) {
    violations.push(
      "app/application/workspace-controller.js: generic Bridge command escapes are forbidden",
    );
  }
  if (
    !/\bexport\s+function\s+createRuntimeWorkspaceController\b/u.test(workspaceController)
    || !/\bcreateRuntimeBridgeClient\s*\(/u.test(workspaceController)
    || !/\bnew\s+WorkspaceController\s*\(/u.test(workspaceController)
    || !/\bgetSnapshot\s*\(/u.test(workspaceController)
    || !/\bsubscribe\s*\(/u.test(workspaceController)
    || !/\bsubscribeEvents\s*\(/u.test(workspaceController)
    || !/\bdispose\s*\(/u.test(workspaceController)
  ) {
    violations.push(
      "app/application/workspace-controller.js: runtime factory and public aggregate contract must stay complete",
    );
  }
  if (
    !/#observeSessionSnapshots\s*\(/u.test(workspaceController)
    || !/#publishAggregateSnapshot\s*\(/u.test(workspaceController)
    || !/\bprojectSession:\s*this\.#projectSessionSnapshot/u.test(workspaceController)
    || !/\bdocument:\s*this\.#documentSessionSnapshot/u.test(workspaceController)
    || !/\bcommentSession:\s*this\.#commentSessionSnapshot/u.test(workspaceController)
    || !/\brunSession:\s*this\.#runSessionSnapshot/u.test(workspaceController)
    || !/\bversionSession:\s*this\.#versionSessionSnapshot/u.test(workspaceController)
    || !/\bsetObserver\(null\)/u.test(workspaceController)
  ) {
    violations.push(
      "app/application/workspace-controller.js: Controller must be the sole disposed aggregate observer for Session snapshots",
    );
  }
  if (
    !/\bensureRegistered\s*\(/u.test(workspaceController)
    || !/#registrationPromise\b/u.test(workspaceController)
    || !/\bthis\.#projectSession\.register\s*\(/u.test(workspaceController)
    || !/\bthis\.#sourceHistorySession\.activate\s*\(/u.test(workspaceController)
    || !/\bthis\.#draftSession\.replaceAuthority\s*\(/u.test(workspaceController)
    || !/\breturn\s+stale\(/u.test(workspaceController)
  ) {
    violations.push(
      "app/application/workspace-controller.js: registration publication must remain session-fenced and stale-safe",
    );
  }
  if (
    /\blegacy(?:Port)?\b/u.test(workspaceController)
    || /\blegacy(?:Port)?\b/u.test(projectWorkflow)
    || !/\.subscribeEvents\s*\(/u.test(workspaceController)
  ) {
    violations.push(
      "app/application: final composition must use typed workflow events instead of a legacy adapter",
    );
  }

  for (const { file, source } of applicationSources) {
    if (
      file !== "app/application/workspace-controller.js"
      && new RegExp(`\\bnew\\s+(?:${RUNTIME_SESSION_CONSTRUCTORS.join("|")})\\b`, "u").test(source)
    ) {
      violations.push(
        `${file}: runtime Session construction belongs only to WorkspaceController factory`,
      );
    }
    if (
      file !== "app/application/bridge-client.js"
      && /\b(?:executeBridge|executeCommand|command)\s*\(/u.test(source)
    ) {
      violations.push(
        `${file}: application commands must remain typed; generic Bridge escape is forbidden`,
      );
    }
  }

  if (
    !/\bthis\.#drainCoordinator\.drain\("switch"/u.test(projectWorkflow)
    || !/\bthis\.#drainCoordinator\.drain\("close"/u.test(projectWorkflow)
    || !/\bthis\.#projectRulesWorkflow\.drain\s*\(/u.test(projectWorkflow)
    || !/\bthis\.#projectWorkflow\.drain\("history"/u.test(versionWorkflow)
    || !/\bthis\.#drain\s*\(/u.test(runWorkflow)
  ) {
    violations.push(
      "app/application: switch, close, history, and request boundaries must use typed DrainCoordinator commands",
    );
  }
  if (
    !/\bthis\.#documentWorkflow\.reconcileBoundary\s*\(/u.test(projectWorkflow)
    || !/\bthis\.#canvasPort\.freeze\s*\(/u.test(runWorkflow)
    || !/\bthis\.#bridgeClient\.createRequest\s*\(/u.test(runWorkflow)
    || !/\bthis\.#projectWorkflow\.commitManagedSourceTransition\s*\(/u.test(versionWorkflow)
  ) {
    violations.push(
      "app/application: publication, freeze, and request checks must stay in their typed workflows",
    );
  }
  return violations;
}

export async function architectureViolations() {
  const files = await sourceFiles(path.join(PRODUCT_ROOT, "app"));
  const violations = [];
  const applicationSources = [];
  for (const filePath of files) {
    const file = relative(filePath);
    const source = await readFile(filePath, "utf8");
    if (file.startsWith("app/application/")) {
      applicationSources.push({ file, source });
    }
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
        if (
          specifier === "react"
          || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/.test(specifier)
        ) {
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
  const previewSourceSync = await readFile(
    path.join(PRODUCT_ROOT, "app", "components", "html-canvas-preview-sync.ts"),
    "utf8",
  );
  const previewSourceSurface = await readFile(
    path.join(PRODUCT_ROOT, "app", "lib", "align-preview-source-surface.js"),
    "utf8",
  );
  const editRuntimeSession = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "edit-author-runtime-session.js",
    ),
    "utf8",
  );
  const editRuntimeProtocol = await readFile(
    path.join(PRODUCT_ROOT, "desktop", "edit-runtime-protocol.mjs"),
    "utf8",
  );
  const editRuntimeBootstrap = await readFile(
    path.join(PRODUCT_ROOT, "desktop", "edit-runtime-bootstrap.mjs"),
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
  const projectRulesSession = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "project-rules-session.js",
    ),
    "utf8",
  );
  const projectRulesWorkflow = await readFile(
    path.join(
      PRODUCT_ROOT,
      "app",
      "application",
      "project-rules-workflow.js",
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
  violations.push(...compositionBoundaryViolations({
    workbench,
    workspaceController,
    projectWorkflow,
    runWorkflow,
    versionWorkflow,
    applicationSources,
  }));
  if (
    !workspaceController.includes("export class WorkspaceController")
    || !workspaceController.includes("ensureRegistered({")
    || !workspaceController.includes("#registrationPromise")
    || !workspaceController.includes("this.#projectSession.register({")
    || !workspaceController.includes("this.#draftSession.replaceAuthority(")
    || !workspaceController.includes("this.#sourceHistorySession.activate(")
    || !workspaceController.includes("return stale(identity)")
  ) {
    violations.push(
      "app/application/workspace-controller.js: registration must own the injected Session transition, single-flight, and stale fence",
    );
  }
  if (
    /\bensureProjectRegistered\b|\bprojectRegistrationPromiseRef\b/.test(workbench)
    || !workbench.includes("createRuntimeWorkspaceController({")
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
    RETIRED_WORKBENCH_MIGRATION_OWNERS.test(workbench)
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
  if (bridgeCalls.length > 0) {
    violations.push(
      "app/workbench.tsx: direct Bridge calls are absolutely forbidden after PR-7",
    );
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
    || !workbench.includes("getCurrentProjectContext()")
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
    !workbench.includes("workspaceControllerSnapshot?.runSession")
    || /\b(?:backgroundRunsRef|backgroundProjectResultsRef|qoderHandoffStatesRef|activeRunRef|activatingRunsRef|cancellingRunsRef|resolvingRunsRef|statusPollBusyRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: AI run state and operation locks belong to RunSession",
    );
  }
  if (
    !workbench.includes("workspaceControllerSnapshot?.versionSession")
    || /\b(?:setVersions|setLatestVersionId|setCurrentBasedOnVersionId|setCurrentExactVersionId|setRestoredFromVersionId|setViewMode|setViewingVersionId)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: Version authority and history view transitions belong to VersionSession",
    );
  }
  if (
    !workbench.includes("workspaceControllerSnapshot?.document")
    || /\b(?:htmlRef|sourceShaRef|editRevisionRef|lastPersistedRevisionRef|persistStateRef|pendingWriteRef|flushPromiseRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: source bytes, revisions and write state belong to DocumentSession",
    );
  }
  if (
    !workbench.includes("workspaceControllerSnapshot?.commentSession")
    || /\b(?:commentsRef|changeEventsRef|deletedCommentIdsRef|composerDraftRef|composerCommentIdRef|composerAttachmentsRef|draftTargetRef|commentEditSessionRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: comment working-copy state belongs to CommentSession",
    );
  }
  if (
    /\b(?:handleDraftSessionEvent|flushDraftPersistence|persistDraftRecovery|persistCurrentDraftRecovery|attachmentUploadCountRef|draftRecoveryOperationIdRef|deleteAttachmentFile)\b/.test(workbench)
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
    !workspaceController.includes("import { ProjectRulesSession }")
    || !workspaceController.includes("import { ProjectRulesWorkflow }")
    || !workspaceController.includes("this.#projectRulesWorkflow = new ProjectRulesWorkflow({")
    || !workspaceController.includes("new ProjectRulesSession()")
    || !workspaceController.includes("projectRules: this.#projectRulesSnapshot")
    || !workspaceController.includes("openProjectRules(input)")
    || !workspaceController.includes("saveProjectRules()")
    || !workspaceController.includes("this.#projectRulesWorkflow?.dispose()")
  ) {
    violations.push(
      "app/application/workspace-controller.js: PROJECT.md workflow must be composed, projected and disposed by WorkspaceController",
    );
  }
  if (
    !projectRulesSession.includes("export class ProjectRulesSession")
    || !projectRulesSession.includes("beginOpen(context)")
    || !projectRulesSession.includes("completeOpen(token, payload)")
    || !projectRulesSession.includes("beginSave()")
    || !projectRulesSession.includes("completeSave(token)")
    || /(?:#bridgeClient|\.projectFile\(|\.updateProjectFile\()/.test(projectRulesSession)
  ) {
    violations.push(
      "app/application/project-rules-session.js: PROJECT.md mutable editor facts must remain free of Bridge I/O",
    );
  }
  if (
    !projectRulesWorkflow.includes("export class ProjectRulesWorkflow")
    || !projectRulesWorkflow.includes("const AUTOSAVE_DELAY_MS = 700")
    || !projectRulesWorkflow.includes("async open({ context }")
    || !projectRulesWorkflow.includes("this.#bridgeClient.projectFile(")
    || !projectRulesWorkflow.includes("this.#bridgeClient.updateProjectFile({")
    || !projectRulesWorkflow.includes("resetForProjectTransition()")
    || !projectRulesWorkflow.includes("async drain()")
    || !projectRulesWorkflow.includes("this.#presentationPort.restoreEditor({")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(projectRulesWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/project-rules-workflow.js: PROJECT.md Bridge I/O, 700ms autosave, reconciliation and drain must stay in the application boundary",
    );
  }
  if (
    !projectWorkflow.includes("this.#projectRulesWorkflow.inspect()")
    || !projectWorkflow.includes("this.#projectRulesWorkflow.drain()")
    || /\bprojectRulesSession\b/.test(projectWorkflow)
  ) {
    violations.push(
      "app/application/project-workflow.js: project-rule drain must delegate to ProjectRulesWorkflow without a legacy Session callback",
    );
  }
  if (
    !workbench.includes("projectRulesWorkflow: {")
    || !workbench.includes(".openProjectRules({")
    || !workbench.includes(".updateProjectRules({")
    || !workbench.includes(".saveProjectRules()")
    || !workbench.includes(".closeProjectRules()")
    || /\b(?:projectRulesSessionRef|saveProjectRulesRef|PROJECT_RULES_AUTOSAVE_DELAY_MS)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PROJECT.md must use Controller commands and a snapshot projection; Workbench cannot own its timer, Session or Bridge I/O",
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
    || !workspaceController.includes("continueEditingHistoryVersion(input)")
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
    || !versionWorkflow.includes("async continueEditingHistoryVersion({")
    || !versionWorkflow.includes("this.#bridgeClient.versionFile(")
    || !versionWorkflow.includes("this.#bridgeClient.source(")
    || !versionWorkflow.includes("this.#bridgeClient.activateReadyVersion({")
    || !versionWorkflow.includes("this.#bridgeClient.continueEditingHistoryVersion({")
    || !versionWorkflow.includes("this.#projectWorkflow.commitManagedSourceTransition({")
    || !versionWorkflow.includes("#rollbackNavigation(operation, previous)")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(versionWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/version-workflow.js: Version validation, activation, historical Working Copy continuation, immutable review preparation and rollback navigation must stay in the application boundary",
    );
  }
  if (
    !projectWorkflow.includes("async prepareManagedSourceTransition({")
    || !projectWorkflow.includes("commitManagedSourceTransition({")
  ) {
    violations.push(
      "app/application/project-workflow.js: Version activation and historical continuation must reuse the synchronous managed-source publication API",
    );
  }
  if (
    bridgeCalls.length !== 0
    || !workbench.includes("versionWorkflow: {")
    || !workbench.includes(".prepareReviewCandidate({ run })")
    || !workbench.includes(".activateReadyVersion({")
    || !workbench.includes(".viewHistory({ version, context")
    || !workbench.includes(".returnToCurrent({ context })")
    || !workbench.includes(".continueEditingHistoryVersion({")
    || /\b(?:openCommittedVersion|prepareManagedSourceTransition|commitManagedSourceTransition|prepareGeneratedSourceTransition|commitGeneratedSourceTransition|navigationOperationRef|viewTransitioningRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PR-6 Version IO and navigation ownership must delegate to WorkspaceController; Workbench keeps only review presentation and outcome mapping",
    );
  }

  if (
    !workspaceController.includes("import { EditAuthorRuntimeSession }")
    || !workspaceController.includes("new EditAuthorRuntimeSession({")
    || !workspaceController.includes("#refreshEditAuthorRuntime()")
    || !workspaceController.includes("beginEditAuthorRuntime(input)")
    || !workspaceController.includes("settleEditAuthorRuntime(input)")
    || !workspaceController.includes("editRuntime: this.#editRuntimeSnapshot")
  ) {
    violations.push(
      "app/application/workspace-controller.js: one-shot Edit runtime state must remain a Controller-owned Session projection",
    );
  }
  if (
    /\bhtmlAIEditRuntime\??\.(?:prepare|revoke)\s*\(/u.test(workbench)
    || !workbench.includes("workspaceControllerRef.current?.beginEditAuthorRuntime({")
    || !workbench.includes("workspaceControllerRef.current?.settleEditAuthorRuntime({")
  ) {
    violations.push(
      "app/workbench.tsx: the view may pass the narrow runtime port at composition time but cannot manage its lifecycle",
    );
  }
  if (
    !editRuntimeSession.includes("sameKey(this.#identity, identity)")
    || !editRuntimeSession.includes("sourcePath === right.sourcePath")
    || !editRuntimeSession.includes("canvasGeneration === right.canvasGeneration")
    || !editRuntimeSession.includes("phase: \"settled\"")
    || /\b(?:EditRuntimeProbe|probe[A-Z_]|promoteRuntimeFrame|compatibilityCache|cacheTtl)\b/u.test(editRuntimeSession)
    || /\b(?:EditRuntimeProbe|probe[A-Z_]|promoteRuntimeFrame|compatibilityCache|cacheTtl)\b/u.test(editRuntimeProtocol)
  ) {
    violations.push(
      "Edit runtime must use one direct sourcePath/canvasGeneration session without probe, promotion, or compatibility cache state",
    );
  }
  if (
    !canvasEditor.includes("runtimeAttemptedRef")
    || !canvasEditor.includes("forceStatic: true")
    || !canvasEditor.includes("data-pageroot-edit-runtime-host")
    || !canvasEditor.includes('mode: "one-shot-runtime"')
    || !canvasEditor.includes("allow-scripts")
    || !canvasEditor.includes("EDIT_RUNTIME_FROZEN_ATTRIBUTE")
    || !canvasEditor.includes("runtimeFrameKeepsAuthorPaint")
    || !canvasEditor.includes("hostHasAuthorPaint")
    || !canvasEditor.includes("frame.grant.hosts.some")
    || canvasEditor.includes("frame.grant.hosts.every")
    || !canvasEditor.includes("alignPreviewSourceSurface")
    || !canvasEditor.includes("previewHostStillMounted")
    || !canvasEditor.includes('active.mode === "text-fragment"')
    || !previewSourceSync.includes("../lib/align-preview-source-surface.js")
    || !previewSourceSurface.includes("skipDescendantsOf")
    || !canvasEditor.includes("settledRuntimeFrameIsCurrent")
    || !canvasEditor.includes("detachedRuntimeFrame && !preserveForHistory")
    || !canvasEditor.includes("frameReloadRequired && !settledRuntimeFrame")
    || canvasEditor.includes('img[src^="data:image/png"]')
    || /pngBase64|static-runtime-snapshot|mountFrozenRuntimeSnapshots|object-fit:\s*fill/u.test(canvasEditor)
  ) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: one-shot runtime frames must execute once in the final iframe, keep real canvas/svg, and never mount PNG substitutes",
    );
  }
  if (
    !editRuntimeBootstrap.includes("closeTrackedPorts")
    || !editRuntimeBootstrap.includes("MessageChannel")
    || !editRuntimeBootstrap.includes("messagePortClose")
  ) {
    violations.push(
      "desktop/edit-runtime-bootstrap.mjs: freeze must drain MessageChannel/MessagePort callbacks before accepting the retained iframe",
    );
  }
  const adr0025 = await readFile(
    path.join(PRODUCT_ROOT, "docs", "decisions", "0025-edit-direct-one-shot-runtime.md"),
    "utf8",
  );
  const interactionFlow = await readFile(
    path.join(PRODUCT_ROOT, "docs", "INTERACTION_FLOW.md"),
    "utf8",
  );
  if (
    /A later full-frame rebuild in the same generation is static/u.test(adr0025)
    || /必要的完整帧重建在本代只加载静态/u.test(interactionFlow)
    || !adr0025.includes("forbids Ready")
    || !adr0025.includes("explicitly start a new `canvasGeneration`")
    || !adr0025.includes("static-Edit compromise")
    || !adr0025.includes("htmlAIProjects")
    || !adr0025.includes("MessageChannel")
    || !adr0025.includes("Source-authored inline PNG")
    || /Low-cost boundaries remain: no Node, no preload, no direct IPC/u.test(adr0025)
    || !interactionFlow.includes("静默静态重建不是已接受的产品合同")
  ) {
    violations.push(
      "ADR 0025 / INTERACTION_FLOW: after interaction, same-generation static remount is a Ready stop, not an accepted structural fallback",
    );
  }
  const previewSandbox = await readFile(
    path.join(PRODUCT_ROOT, "app", "components", "html-preview-sandbox.js"),
    "utf8",
  );
  if (
    !previewSandbox.includes("prepareOneShotRuntimeFrameDocument")
    || !previewSandbox.includes('mode === "one-shot-runtime"')
    || previewSandbox.includes("static-runtime-snapshot")
    || previewSandbox.includes("prepareStaticRuntimeSnapshotFrameDocument")
  ) {
    violations.push(
      "app/components/html-preview-sandbox.js: Edit runtime documents must be one-shot-runtime, not static PNG hosts",
    );
  }
  const desktopMain = await readFile(
    path.join(PRODUCT_ROOT, "desktop", "main.mjs"),
    "utf8",
  );
  if (
    /edit-runtime-capture-owner|createEditRuntimeCaptureController|ensureEditRuntimeCaptureController/u.test(desktopMain)
    || /capturePage\s*\(/u.test(editRuntimeProtocol)
    || /runtimeHtml|buildRuntimeDocument/u.test(editRuntimeProtocol)
  ) {
    violations.push(
      "desktop Edit runtime must prepare a direct resource session only; capture windows and PNG handoff cannot return",
    );
  }
  const desktopFiles = await sourceFiles(path.join(PRODUCT_ROOT, "desktop"));
  if (desktopFiles.some((filePath) => relative(filePath).includes("edit-runtime-probe"))) {
    violations.push(
      "desktop: retired Edit runtime probe owners cannot return to production",
    );
  }
  if (desktopFiles.some((filePath) => relative(filePath).includes("edit-runtime-capture-owner"))) {
    violations.push(
      "desktop: Edit runtime capture owner cannot return to production",
    );
  }
  const reviewCaptureOwner = desktopFiles.find((filePath) => (
    relative(filePath).includes("runtime-visual-capture-owner")
  ));
  if (!reviewCaptureOwner) {
    violations.push(
      "desktop/runtime-visual-capture-owner.mjs must remain the Review-only capture owner",
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
