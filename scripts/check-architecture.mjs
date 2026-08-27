#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseModule,
  importsModule,
  exportsSymbol,
  classHasMember,
  classMemberConstructs,
  hasCall,
  constructsClass,
  hasObjectProperty,
  countReactHooks,
} from "./architecture-ast-query.mjs";

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
  "FirstEditGuideSession",
];
const PROVIDER_LITERAL_BRANCH = /\b(?:[A-Za-z_$][\w$]*\s*(?:\?\.|\.)\s*)*(?:providerId|mode)\s*(?:===|!==|==|!=)\s*["'`](?:qoder|codex|qoder-acp|codex-acp)["'`]|["'`](?:qoder|codex|qoder-acp|codex-acp)["'`]\s*(?:===|!==|==|!=)\s*(?:[A-Za-z_$][\w$]*\s*(?:\?\.|\.)\s*)*(?:providerId|mode)\b/u;
const PROVIDER_IMPLEMENTATION_IMPORT = /(?:^|\/)(?:qoder-availability|QoderAvailabilityCard|qoder-provider)(?:\.[^/]*)?$/u;

const POINTER_CAPABILITY_FILES = new Set([
  "app/components/html-canvas-pointer-capability.ts",
  "app/components/html-canvas-pointer-proof.js",
]);

export function canvasPointerLayerViolations({ file = "", source = "" } = {}) {
  if (!POINTER_CAPABILITY_FILES.has(file)) return [];
  if (/\bisNativeDirectEditRoot\b/u.test(source)) {
    return [
      `${file}: pointer capability must not approximate editability from native-edit tag roots`,
    ];
  }
  return [];
}

export function providerNeutralRendererViolations({ file = "", source = "" } = {}) {
  const violations = [];
  const workflow = /^app\/application\/(?:run|review|version)[^/]*\.(?:js|ts)$/u.test(file);
  const react = /\.tsx$/u.test(file);
  if ((workflow || react) && PROVIDER_LITERAL_BRANCH.test(source)) {
    violations.push(`${file}: provider selection branches must use canonical delivery and descriptor data`);
  }
  if (
    workflow
    && importedSpecifiers(source).some((specifier) => PROVIDER_IMPLEMENTATION_IMPORT.test(specifier))
  ) {
    violations.push(`${file}: workflows cannot import provider implementations or legacy presentation`);
  }
  return violations;
}

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
    /\bnew\s+(?:ProjectSession|DocumentSession|CommentSession|DraftSession|VersionSession|SourceHistorySession|RunSession|ProjectRulesSession|ExternalFileOpenSession|ProjectApplicationSession|FirstEditGuideSession)\b/u.test(workbench)
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
    violations.push(...providerNeutralRendererViolations({ file, source }));
    violations.push(...canvasPointerLayerViolations({ file, source }));
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
      || file === "app/workbench/ExternalHtmlOpenDialog.tsx"
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

  const scriptFiles = [
    ...(await sourceFiles(path.join(PRODUCT_ROOT, "scripts"))),
    ...(await sourceFiles(path.join(PRODUCT_ROOT, "bridge"))),
  ];
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
        "bridge/draft-service.mjs",
        "scripts/check-architecture.mjs",
      ].includes(file)
    ) {
      violations.push(`${file}: draft command policy belongs to draft-service`);
    }
  }

  const workspaceBridge = await readFile(
    path.join(PRODUCT_ROOT, "bridge", "workspace-bridge.mjs"),
    "utf8",
  );
  const sourceTransactionService = await readFile(
    path.join(PRODUCT_ROOT, "bridge", "source-transaction-service.mjs"),
    "utf8",
  );
  const workspaceBridgeAst = parseModule(
    path.join(PRODUCT_ROOT, "bridge", "workspace-bridge.mjs"),
    workspaceBridge,
  );
  const sourceTransactionServiceAst = parseModule(
    path.join(PRODUCT_ROOT, "bridge", "source-transaction-service.mjs"),
    sourceTransactionService,
  );
  if (
    importsModule(workspaceBridgeAst, "./source-transaction-service.mjs")
    || importsModule(workspaceBridgeAst, "./project-context-service.mjs")
    || importsModule(workspaceBridgeAst, "./source-history-service.mjs")
    || hasCall(workspaceBridgeAst, { method: "commitSourceTransaction" })
    || hasCall(workspaceBridgeAst, { method: "loadContextBySource" })
    || hasCall(workspaceBridgeAst, { method: "loadMutationContext" })
  ) {
    violations.push(
      "bridge/workspace-bridge.mjs: must not import or call the retired v3 registry, SourceTransaction, or source-history journal",
    );
  }
  if (
    !importsModule(workspaceBridgeAst, "./project-file-repository.mjs")
    || !hasCall(workspaceBridgeAst, { method: "saveProjectFileAutosave" })
  ) {
    violations.push(
      "bridge/workspace-bridge.mjs: /autosave must delegate to ProjectFileRepository",
    );
  }
  if (
    /async function atomicReplaceSource\b/.test(workspaceBridge)
    || /\bwriteSourceHistory\s*\(/.test(workspaceBridge)
  ) {
    violations.push(
      "bridge/workspace-bridge.mjs: current-source writer belongs to ProjectFileRepository",
    );
  }
  if (
    !exportsSymbol(sourceTransactionServiceAst, "commitSourceTransaction", { kind: "function" })
    || !exportsSymbol(sourceTransactionServiceAst, "recoverPendingSourceTransaction", { kind: "function" })
    || !/async function atomicReplaceSource\b/.test(sourceTransactionService)
    || !hasCall(sourceTransactionServiceAst, { method: "writeSourceHistory" })
  ) {
    violations.push(
      "bridge/source-transaction-service.mjs: SourceTransaction must own commit, recovery, and source-history application",
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
  const canvasFrame = await readFile(
    path.join(PRODUCT_ROOT, "app", "components", "html-canvas-frame.js"),
    "utf8",
  );
  const canvasNativeCommands = await readFile(
    path.join(PRODUCT_ROOT, "app", "components", "html-canvas-native-commands.js"),
    "utf8",
  );
  const firstEditGuideCard = await readFile(
    path.join(PRODUCT_ROOT, "app", "components", "FirstEditGuideCard.tsx"),
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
  // Parse the modules that carry structural contracts once. AST handles let the
  // gate assert imports, exports, class members and calls without matching
  // source-string fragments, so a rename or reflow cannot fail an otherwise
  // compliant module and a dead string cannot pass it.
  const workbenchAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "workbench.tsx"),
    workbench,
  );
  const workspaceControllerAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "workspace-controller.js"),
    workspaceController,
  );
  const projectWorkflowAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "project-workflow.js"),
    projectWorkflow,
  );
  const runWorkflowAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "run-workflow.js"),
    runWorkflow,
  );
  const versionWorkflowAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "version-workflow.js"),
    versionWorkflow,
  );
  const commentWorkflowAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "comment-workflow.js"),
    commentWorkflow,
  );
  const projectRulesWorkflowAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "project-rules-workflow.js"),
    projectRulesWorkflow,
  );
  const projectRulesSessionAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "application", "project-rules-session.js"),
    projectRulesSession,
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
    !exportsSymbol(workspaceControllerAst, "WorkspaceController", { kind: "class" })
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "ensureRegistered")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "#registrationPromise")
    || !hasCall(workspaceControllerAst, { path: "this.#projectSession.register" })
    || !hasCall(workspaceControllerAst, { path: "this.#draftSession.replaceAuthority" })
    || !hasCall(workspaceControllerAst, { path: "this.#sourceHistorySession.activate" })
    || !hasCall(workspaceControllerAst, { method: "stale" })
  ) {
    violations.push(
      "app/application/workspace-controller.js: registration must own the injected Session transition, single-flight, and stale fence",
    );
  }
  if (
    /\bensureProjectRegistered\b|\bprojectRegistrationPromiseRef\b/.test(workbench)
    || !hasCall(workbenchAst, { method: "createRuntimeWorkspaceController" })
    || !hasCall(workbenchAst, { method: "ensureRegistered" })
    || /workspaceController\.getSnapshot\(\)\.registration\.phase\s*===\s*"registering"/.test(
      workbench,
    )
  ) {
    violations.push(
      "app/workbench.tsx: project registration must delegate to WorkspaceController without blocking a newer locator",
    );
  }
  if (
    !classMemberConstructs(workspaceControllerAst, "WorkspaceController", "#drainCoordinator", "DrainCoordinator")
    || !constructsClass(workspaceControllerAst, "ProjectWorkflow")
    || !constructsClass(workspaceControllerAst, "ExternalFileOpenSession")
    || !constructsClass(workspaceControllerAst, "ProjectApplicationSession")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "prepareClose")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "readProjectFile")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "openProjectRecords")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "observeExternalSourceChange")
    || !hasCall(workspaceControllerAst, { method: "reconcileExternalSourceLocator" })
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-3 must own one DrainCoordinator and compose the project transition workflow",
    );
  }
  if (
    !exportsSymbol(projectWorkflowAst, "ProjectWorkflow", { kind: "class" })
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "prepareSwitch")
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "acceptProject")
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "openProject")
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "prepareClose")
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "abortClose")
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "#hydrationGeneration")
    || !hasCall(projectWorkflowAst, { path: "this.#projectApplicationSession.enqueue" })
    || !hasCall(projectWorkflowAst, { path: "this.#projectSession.openLocator" })
    || !hasCall(projectWorkflowAst, { path: "this.#documentSession.publishAuthority" })
    || !hasCall(projectWorkflowAst, { path: "this.#versionSession.hydrate" })
    || !hasCall(projectWorkflowAst, { path: "this.#canvasPort.invalidateRenderAcks" })
    || !hasCall(projectWorkflowAst, { path: "this.#bridgeClient.projectFile" })
    || !hasCall(projectWorkflowAst, { path: "this.#bridgeClient.openFolder" })
    || !hasCall(projectWorkflowAst, { method: "reconcileExternalSourceLocator" })
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "#sourceLocatorPromise")
    || !hasCall(projectWorkflowAst, { path: "this.#projectOpenPort.reconcileActiveManagedSource" })
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "#publishSourceLocatorChange")
    || !/sourceMissing === false/.test(projectWorkflow)
  ) {
    violations.push(
      "app/application/project-workflow.js: hydration, accepted FIFO, switch, close and project resources must share one typed workflow boundary",
    );
  }
  if (
    RETIRED_WORKBENCH_MIGRATION_OWNERS.test(workbench)
    || !hasObjectProperty(workbenchAst, "projectWorkflow", { valueKind: "object" })
    || !hasCall(workbenchAst, { path: "workspaceController.prepareClose" })
    || !hasCall(workbenchAst, { path: "workspaceController.acceptExternalProject" })
    || !hasCall(workbenchAst, { path: "workspaceController.acceptBrowserProject" })
    || !hasCall(workbenchAst, { method: "readProjectFile" })
    || !hasCall(workbenchAst, { method: "openProjectRecords" })
    || !/\bonSourceFileChanged\b/.test(workbench)
    || !hasCall(workbenchAst, { method: "observeExternalSourceChange" })
    || !hasObjectProperty(workbenchAst, "sourceMissing")
    || /\breconcileManagedWorkingCopy\b/.test(workbench)
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
    !hasObjectProperty(workbenchAst, "documentWorkflow", { valueKind: "object" })
    || !hasCall(workbenchAst, { method: "enqueueDocumentEdit" })
    || !hasCall(workbenchAst, { method: "flushDocument" })
    || !hasCall(workbenchAst, { method: "performDocumentHistoryAction" })
    || !hasCall(workbenchAst, { method: "reloadDocumentAuthority" })
    || !hasCall(workbenchAst, { method: "forceUnlockDocumentConflict" })
    || !hasCall(workbenchAst, { method: "observeExternalSourceChange" })
    || !hasCall(projectWorkflowAst, { path: "this.#documentWorkflow.reconcileBoundary" })
    || !hasCall(projectWorkflowAst, { path: "this.#documentWorkflow.observeExternalSourceChange" })
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
    || !hasCall(workbenchAst, { method: "getCurrentProjectContext" })
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
    || !hasObjectProperty(workbenchAst, "commentWorkflow", { valueKind: "object" })
    || !hasCall(workbenchAst, { method: "commitComment" })
    || !hasCall(workbenchAst, { method: "uploadAttachments" })
    || !hasCall(workbenchAst, { method: "flushDraft" })
  ) {
    violations.push(
      "app/workbench.tsx: PR-4 comment persistence and attachment IO must delegate to CommentWorkflow",
    );
  }
  if (
    !constructsClass(workspaceControllerAst, "CommentWorkflow")
    || !hasObjectProperty(workspaceControllerAst, "comment")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "commitComment")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "uploadAttachments")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "flushDraft")
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-4 must compose and expose CommentWorkflow commands and projection",
    );
  }
  if (
    !constructsClass(workspaceControllerAst, "ProjectRulesWorkflow")
    || !constructsClass(workspaceControllerAst, "ProjectRulesSession")
    || !hasObjectProperty(workspaceControllerAst, "projectRules")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "openProjectRules")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "saveProjectRules")
    || !hasCall(workspaceControllerAst, { path: "this.#projectRulesWorkflow.dispose" })
  ) {
    violations.push(
      "app/application/workspace-controller.js: PROJECT.md workflow must be composed, projected and disposed by WorkspaceController",
    );
  }
  if (
    !exportsSymbol(projectRulesSessionAst, "ProjectRulesSession", { kind: "class" })
    || !classHasMember(projectRulesSessionAst, "ProjectRulesSession", "beginOpen")
    || !classHasMember(projectRulesSessionAst, "ProjectRulesSession", "completeOpen")
    || !classHasMember(projectRulesSessionAst, "ProjectRulesSession", "beginSave")
    || !classHasMember(projectRulesSessionAst, "ProjectRulesSession", "completeSave")
    || /(?:#bridgeClient|\.projectFile\(|\.updateProjectFile\()/.test(projectRulesSession)
  ) {
    violations.push(
      "app/application/project-rules-session.js: PROJECT.md mutable editor facts must remain free of Bridge I/O",
    );
  }
  if (
    !exportsSymbol(projectRulesWorkflowAst, "ProjectRulesWorkflow", { kind: "class" })
    || !/const AUTOSAVE_DELAY_MS = 700\b/.test(projectRulesWorkflow)
    || !classHasMember(projectRulesWorkflowAst, "ProjectRulesWorkflow", "open")
    || !hasCall(projectRulesWorkflowAst, { path: "this.#bridgeClient.projectFile" })
    || !hasCall(projectRulesWorkflowAst, { path: "this.#bridgeClient.updateProjectFile" })
    || !classHasMember(projectRulesWorkflowAst, "ProjectRulesWorkflow", "resetForProjectTransition")
    || !classHasMember(projectRulesWorkflowAst, "ProjectRulesWorkflow", "drain")
    || !hasCall(projectRulesWorkflowAst, { path: "this.#presentationPort.restoreEditor" })
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(projectRulesWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/project-rules-workflow.js: PROJECT.md Bridge I/O, 700ms autosave, reconciliation and drain must stay in the application boundary",
    );
  }
  if (
    !hasCall(projectWorkflowAst, { path: "this.#projectRulesWorkflow.inspect" })
    || !hasCall(projectWorkflowAst, { path: "this.#projectRulesWorkflow.drain" })
    || /\bprojectRulesSession\b/.test(projectWorkflow)
  ) {
    violations.push(
      "app/application/project-workflow.js: project-rule drain must delegate to ProjectRulesWorkflow without a legacy Session callback",
    );
  }
  if (
    !hasObjectProperty(workbenchAst, "projectRulesWorkflow", { valueKind: "object" })
    || !hasCall(workbenchAst, { method: "openProjectRules" })
    || !hasCall(workbenchAst, { method: "updateProjectRules" })
    || !hasCall(workbenchAst, { method: "saveProjectRules" })
    || !hasCall(workbenchAst, { method: "closeProjectRules" })
    || /\b(?:projectRulesSessionRef|saveProjectRulesRef|PROJECT_RULES_AUTOSAVE_DELAY_MS)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PROJECT.md must use Controller commands and a snapshot projection; Workbench cannot own its timer, Session or Bridge I/O",
    );
  }
  if (
    !constructsClass(workspaceControllerAst, "RunWorkflow")
    || !hasObjectProperty(workspaceControllerAst, "run")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "submitRequest")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "cancelRun")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "resolveRunConflict")
    || !hasCall(workspaceControllerAst, { path: "this.#runWorkflow.dispose" })
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-5 must compose RunWorkflow, expose commands, project its snapshot, and dispose its poller",
    );
  }
  if (
    !exportsSymbol(runWorkflowAst, "RunWorkflow", { kind: "class" })
    || !classHasMember(runWorkflowAst, "RunWorkflow", "submit")
    || !classHasMember(runWorkflowAst, "RunWorkflow", "reconcileSubmission")
    || !classHasMember(runWorkflowAst, "RunWorkflow", "pollNow")
    || !classHasMember(runWorkflowAst, "RunWorkflow", "cancel")
    || !classHasMember(runWorkflowAst, "RunWorkflow", "resolveConflict")
    || !hasCall(runWorkflowAst, { path: "this.#bridgeClient.createRequest" })
    || !hasCall(runWorkflowAst, { path: "this.#bridgeClient.workspace" })
    || !hasCall(runWorkflowAst, { path: "this.#bridgeClient.status" })
    || !hasCall(runWorkflowAst, { path: "this.#bridgeClient.cancelActiveRun" })
    || !hasCall(runWorkflowAst, { path: "this.#bridgeClient.resolveConflict" })
    || !hasCall(runWorkflowAst, { path: "this.#runSession.markSubmissionUncertain" })
    || !hasCall(runWorkflowAst, { path: "this.#runSession.hasRun" })
    || !classHasMember(runWorkflowAst, "RunWorkflow", "#pollGeneration")
    || !classHasMember(runWorkflowAst, "RunWorkflow", "stopPolling")
    || !hasCall(runWorkflowAst, { path: "this.#handoffPort.copy" })
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(runWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/run-workflow.js: Request, read-only reconciliation, fenced polling, cancellation, conflict resolution, and handoff confirmation must stay in the application boundary",
    );
  }
  if (
    !hasObjectProperty(workbenchAst, "runWorkflow", { valueKind: "object" })
    || !hasCall(workbenchAst, { method: "submitRequest" })
    || !hasCall(workbenchAst, { method: "copyRunHandoff" })
    || !hasCall(workbenchAst, { method: "cancelRun" })
    || !hasCall(workbenchAst, { method: "resolveRunConflict" })
    || /\bbridgeClient\.(?:workspace|createRequest|status|cancelActiveRun|resolveConflict)\s*\(/.test(workbench)
    || /\b(?:processRunStatus|reconcilePendingRun|sendToQoderWork|hydrateRecentProjectRuns)\b/.test(workbench)
    || /const\s+timer\s*=\s*window\.setInterval\(/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PR-5 Run commands and timer lifecycle must delegate to WorkspaceController/RunWorkflow; Workbench keeps only host adapters and presentation",
    );
  }
  if (
    !exportsSymbol(commentWorkflowAst, "CommentWorkflow", { kind: "class" })
    || !classHasMember(commentWorkflowAst, "CommentWorkflow", "#uploadCount")
    || !classHasMember(commentWorkflowAst, "CommentWorkflow", "#recoveryOperationId")
    || !hasCall(commentWorkflowAst, { path: "this.#draftSession.setObserver" })
    || !classHasMember(commentWorkflowAst, "CommentWorkflow", "uploadAttachments")
    || !classHasMember(commentWorkflowAst, "CommentWorkflow", "deleteAttachment")
    || !classHasMember(commentWorkflowAst, "CommentWorkflow", "flushDraft")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)/.test(
      importedSpecifiers(commentWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/comment-workflow.js: Draft recovery, upload compensation, and durable attachment commands must stay in the application boundary",
    );
  }
  if (
    !hasCall(projectWorkflowAst, { path: "this.#commentWorkflow.inspectAttachment" })
    || !hasCall(projectWorkflowAst, { path: "this.#commentWorkflow.drainDraft" })
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
    !hasCall(versionWorkflowAst, { path: "this.#projectWorkflow.drain" })
    || !hasCall(workbenchAst, { method: "viewHistory" })
  ) {
    violations.push(
      "app/application/version-workflow.js: history must delegate to the Controller DrainCoordinator",
    );
  }

  if (
    !constructsClass(workspaceControllerAst, "VersionWorkflow")
    || !hasObjectProperty(workspaceControllerAst, "version")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "prepareReviewCandidate")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "activateReadyVersion")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "viewHistory")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "returnToCurrent")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "continueEditingHistoryVersion")
    || !hasCall(workspaceControllerAst, { path: "this.#versionWorkflow.dispose" })
  ) {
    violations.push(
      "app/application/workspace-controller.js: PR-6 must compose VersionWorkflow, expose its commands, project navigation state and dispose it",
    );
  }
  if (
    !exportsSymbol(versionWorkflowAst, "VersionWorkflow", { kind: "class" })
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "prepareReviewCandidate")
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "activateReadyVersion")
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "openCommittedVersion")
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "viewHistory")
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "returnToCurrent")
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "continueEditingHistoryVersion")
    || !hasCall(versionWorkflowAst, { path: "this.#bridgeClient.versionFile" })
    || !hasCall(versionWorkflowAst, { path: "this.#bridgeClient.source" })
    || !hasCall(versionWorkflowAst, { path: "this.#bridgeClient.activateReadyVersion" })
    || !hasCall(versionWorkflowAst, { path: "this.#bridgeClient.continueEditingHistoryVersion" })
    || !hasCall(versionWorkflowAst, { path: "this.#projectWorkflow.commitManagedSourceTransition" })
    || !classHasMember(versionWorkflowAst, "VersionWorkflow", "#rollbackNavigation")
    || /(?:^|\/)(?:workbench|components|desktop)(?:\/|$)|\breact\b/u.test(
      importedSpecifiers(versionWorkflow).join("\n"),
    )
  ) {
    violations.push(
      "app/application/version-workflow.js: Version validation, activation, historical Working Copy continuation, immutable review preparation and rollback navigation must stay in the application boundary",
    );
  }
  if (
    !classHasMember(projectWorkflowAst, "ProjectWorkflow", "prepareManagedSourceTransition")
    || !classHasMember(projectWorkflowAst, "ProjectWorkflow", "commitManagedSourceTransition")
  ) {
    violations.push(
      "app/application/project-workflow.js: Version activation and historical continuation must reuse the synchronous managed-source publication API",
    );
  }
  if (
    bridgeCalls.length !== 0
    || !hasObjectProperty(workbenchAst, "versionWorkflow", { valueKind: "object" })
    || !hasCall(workbenchAst, { method: "prepareReviewCandidate" })
    || !hasCall(workbenchAst, { method: "activateReadyVersion" })
    || !hasCall(workbenchAst, { method: "viewHistory" })
    || !hasCall(workbenchAst, { method: "returnToCurrent" })
    || !hasCall(workbenchAst, { method: "continueEditingHistoryVersion" })
    || /\b(?:openCommittedVersion|prepareManagedSourceTransition|commitManagedSourceTransition|prepareGeneratedSourceTransition|commitGeneratedSourceTransition|navigationOperationRef|viewTransitioningRef)\b/.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: PR-6 Version IO and navigation ownership must delegate to WorkspaceController; Workbench keeps only review presentation and outcome mapping",
    );
  }

  if (
    !constructsClass(workspaceControllerAst, "EditAuthorRuntimeSession")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "#refreshEditAuthorRuntime")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "beginEditAuthorRuntime")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "settleEditAuthorRuntime")
    || !hasObjectProperty(workspaceControllerAst, "editRuntime")
  ) {
    violations.push(
      "app/application/workspace-controller.js: one-shot Edit runtime state must remain a Controller-owned Session projection",
    );
  }
  if (
    /\bhtmlAIEditRuntime\??\.(?:prepare|revoke)\s*\(/u.test(workbench)
    || !hasCall(workbenchAst, { method: "beginEditAuthorRuntime" })
    || !hasCall(workbenchAst, { method: "settleEditAuthorRuntime" })
  ) {
    violations.push(
      "app/workbench.tsx: the view may pass the narrow runtime port at composition time but cannot manage its lifecycle",
    );
  }
  if (
    !constructsClass(workspaceControllerAst, "FirstEditGuideSession")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "evaluateFirstEditGuide")
    || !classHasMember(workspaceControllerAst, "WorkspaceController", "dismissFirstEditGuide")
    || !hasObjectProperty(workspaceControllerAst, "firstEditGuide")
  ) {
    violations.push(
      "app/application/workspace-controller.js: first-real-HTML guide state must remain a Controller-owned Session projection",
    );
  }
  if (
    /\bhtmlAIUiPreferences\??\.(?:get|record)\s*\(/u.test(workbench)
    || !hasCall(workbenchAst, { method: "evaluateFirstEditGuide" })
    || !hasCall(workbenchAst, { method: "dismissFirstEditGuide" })
    || !workbench.includes("<FirstEditGuideCard")
    || !workbench.split("</main>").slice(1).join("</main>").includes("<FirstEditGuideCard")
    || !firstEditGuideCard.includes("createPortal")
    || !firstEditGuideCard.includes("document.body")
    || !/run-submission-started[\s\S]{0,400}dismissFirstEditGuide/u.test(workbench)
    || /keydown[\s\S]{0,400}dismissFirstEditGuide/u.test(workbench)
  ) {
    violations.push(
      "app/workbench.tsx: the view may pass the narrow UI-preferences port at composition time but cannot record guide status itself; the card stays a document.body portal overlay that dismisses on send-to-waiting, not Escape",
    );
  }
  if (
    canvasEditor.includes("FirstEditGuideCard")
    || canvasEditor.includes("dismissFirstEditGuide")
  ) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: first-real-HTML guide overlay must stay on the Workbench window layer",
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
    || !canvasFrame.includes("hostHasAuthorPaint")
    || !canvasFrame.includes("frame.grant.hosts.some")
    || canvasEditor.includes("frame.grant.hosts.every")
    || canvasFrame.includes("frame.grant.hosts.every")
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
    || /pngBase64|static-runtime-snapshot|mountFrozenRuntimeSnapshots/u.test(canvasFrame)
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

  const canvasEditorAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "components", "HtmlCanvasEditor.tsx"),
    canvasEditor,
  );
  const canvasNativeCommandsAst = parseModule(
    path.join(PRODUCT_ROOT, "app", "components", "html-canvas-native-commands.js"),
    canvasNativeCommands,
  );
  // Structural facts only. The ordered statement sequence these blocks used to
  // assert is behavior; it is tracked as E2E behavior debt (see
  // docs/ARCHITECTURE_CONTRACT.md), not matched as source strings here.
  if (
    !hasCall(canvasEditorAst, { method: "planSourcePatch" })
    || !hasCall(canvasEditorAst, { method: "applyPatchPlan" })
    || !hasCall(canvasEditorAst, { path: "onChangeRef.current" })
    || /\b(?:serializeDocument|getSerializedHtml)\b|\.innerHTML\b|onChangeRef\.current\([^)]*outerHTML/su.test(
      canvasEditor,
    )
  ) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: source edits must publish SourcePatch bytes plus their SourceTransaction and must never serialize preview DOM",
    );
  }

  if (
    !hasCall(canvasNativeCommandsAst, { path: "active.session.queuePendingCommand" })
  ) {
    violations.push(
      "app/components/html-canvas-native-commands.js: native command arbitration must reject lower-priority system work before the controller queue",
    );
  }

  if (
    !hasCall(canvasEditorAst, { method: "discardPendingNativeCommands" })
    || !hasCall(canvasEditorAst, { path: "active.session.fenceDispose" })
    || !hasCall(canvasEditorAst, { path: "parentNode.replaceChild" })
  ) {
    violations.push(
      "app/components/HtmlCanvasEditor.tsx: canonical host replacement must retire the native lease before removing the authored DOM host",
    );
  }

  if (
    !hasCall(workbenchAst, { method: "freezeNow" })
  ) {
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
    !hasCall(runWorkflowAst, { path: "this.#canvasPort.freeze" })
    || !hasCall(runWorkflowAst, { path: "this.#hashPort.sha256" })
    || !hasObjectProperty(runWorkflowAst, "expectedSourceSha256")
    || !hasCall(runWorkflowAst, { path: "this.#bridgeClient.createRequest" })
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
  // Budget exceeding is advisory — it prints a visible notice but does not block
  // CI or merge. The intent is to make growth conscious and visible, not to gate
  // delivery on whether someone remembered to bump a number before pushing.
  // Violations are surfaced alongside hints when the gate passes.
  return violations;
}

// Complexity budget ratchet. Compares each file in
// scripts/architecture-budget.json against its recorded ceiling. This is a
// guardrail against silent drift, not a hard cap: exceeding a ceiling prints an
// advisory notice naming the low-friction escape valve (raise the number in the
// same change), while staying under it emits a hint to lower the ceiling so the
// ratchet follows a shrinking file down. Advisories never fail the gate or
// block merge.
export async function budgetFindings() {
  const measurers = {
    maxLines: (source) => source.split("\n").length,
    maxHooks: (source, handle) => countReactHooks(handle),
  };
  const budgetPath = path.join(PRODUCT_ROOT, "scripts", "architecture-budget.json");
  let budget;
  try {
    budget = JSON.parse(await readFile(budgetPath, "utf8"));
  } catch {
    return {
      violations: ["scripts/architecture-budget.json: missing or invalid JSON"],
      hints: [],
    };
  }
  const violations = [];
  const hints = [];
  for (const [relPath, limits] of Object.entries(budget.files ?? {})) {
    const source = await readFile(path.join(PRODUCT_ROOT, relPath), "utf8");
    const handle = parseModule(path.join(PRODUCT_ROOT, relPath), source);
    for (const [metric, ceiling] of Object.entries(limits)) {
      const measure = measurers[metric];
      if (!measure) {
        violations.push(`scripts/architecture-budget.json: unknown metric "${metric}" for ${relPath}`);
        continue;
      }
      const actual = measure(source, handle);
      if (actual > ceiling) {
        violations.push(
          `${relPath}: ${metric} ${actual} exceeds budget ${ceiling} (+${actual - ceiling}). `
          + `This is a ratchet, not a hard cap: if the growth is intentional, raise ${metric} to `
          + `${actual} in scripts/architecture-budget.json in this change. Prefer moving logic out `
          + `over raising the ceiling — the intent is to shrink this file.`,
        );
      } else if (actual < ceiling) {
        hints.push(
          `${relPath}: ${metric} is ${actual}, under budget ${ceiling}; lower it to ${actual} to keep the ratchet tight.`,
        );
      }
    }
  }
  return { violations, hints };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = await architectureViolations();
  if (violations.length > 0) {
    process.stderr.write(`Architecture contract failed:\n- ${violations.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Architecture contract passed.\n");
  }
  const { violations: budgetViolations, hints } = await budgetFindings();
  const notices = [...budgetViolations, ...hints];
  if (notices.length > 0) {
    process.stdout.write(`Budget advisory:\n- ${notices.join("\n- ")}\n`);
  }
}
