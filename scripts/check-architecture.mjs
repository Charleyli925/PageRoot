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
const WORKBENCH_BRIDGE_CALL_ALLOWLIST = new Map([
  ["workspace", 5],
  ["source", 6],
  ["versionFile", 3],
  ["sourceHistoryAction", 2],
  ["resolveConflict", 2],
  ["activateReadyVersion", 1],
  ["attachment", 1],
  ["autosave", 1],
  ["cancelActiveRun", 1],
  ["createRequest", 1],
  ["deleteAttachment", 1],
  ["openFolder", 1],
  ["projectFile", 1],
  ["saveAttachment", 1],
  ["status", 1],
]);
const WORKBENCH_BRIDGE_CALL_LIMIT = 28;

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
  const bridgeCalls = [...workbench.matchAll(
    /\bbridgeClient\.([A-Za-z0-9_]+)\s*\(/g,
  )].map((match) => match[1]);
  const bridgeCallCounts = new Map();
  for (const method of bridgeCalls) {
    bridgeCallCounts.set(method, (bridgeCallCounts.get(method) || 0) + 1);
    if (!WORKBENCH_BRIDGE_CALL_ALLOWLIST.has(method)) {
      violations.push(
        `app/workbench.tsx: Bridge call ${method} is outside the PR-1 migration allowlist`,
      );
    }
  }
  if (bridgeCalls.length > WORKBENCH_BRIDGE_CALL_LIMIT) {
    violations.push(
      `app/workbench.tsx: PR-1 allows at most ${WORKBENCH_BRIDGE_CALL_LIMIT} direct Bridge calls`,
    );
  }
  for (const [method, limit] of WORKBENCH_BRIDGE_CALL_ALLOWLIST) {
    if ((bridgeCallCounts.get(method) || 0) > limit) {
      violations.push(
        `app/workbench.tsx: Bridge call ${method} exceeds its PR-1 migration allowance of ${limit}`,
      );
    }
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
      'runtimeCapabilitiesRef.current.projectOpening === "browser-file"',
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
  for (const boundary of ["close", "switch", "submit", "history"]) {
    if (!new RegExp(`\\.drain\\("${boundary}"`).test(workbench)) {
      violations.push(
        `app/workbench.tsx: ${boundary} must use the shared DrainCoordinator`,
      );
    }
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
    "return { ok: true",
  ])) {
    violations.push(
      "app/workbench.tsx: source transitions must fail closed unless Canvas freezes the exact current source bytes",
    );
  }

  const requestBoundary = sourceSection(
    workbench,
    "const generateRequest = useCallback",
    "const openCommittedVersion = useCallback",
  );
  const createRequestPayload = sourceSection(
    requestBoundary,
    "const payload = await bridgeClient.createRequest({",
    "const run = activeRunFromRecord",
  );
  if (
    !includesInOrder(requestBoundary, [
      "const frozen = editorRef.current?.freezeNow()",
      "const capturedHtml = frozen.html",
      "const persistedSourceSha256 = documentSessionRef.current.sourceSha256",
      "persistedSourceSha256 !== frozen.sourceSha256",
      "bridgeClient.createRequest({",
      "expectedSourceSha256: persistedSourceSha256",
    ])
    || !createRequestPayload
    || /\b(?:html|baseHtml|projection)\s*:/u.test(createRequestPayload)
    || /EditRuntimeSnapshotSession|runtimeVisualProjection|runtimeVisualViewport|htmlAIRuntimeSnapshots|data-pageroot-readonly-visual/u.test(
      workbench,
    )
  ) {
    violations.push(
      "app/workbench.tsx: AI requests must bind the exact frozen persisted source and Edit must not own a runtime projection",
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
