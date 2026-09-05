export const SEEDED_FAULTS = [
  {
    id: "active-iframe-cleared",
    owner: "runtime-continuity",
    killer: "electron-editing-smoke",
    productionFile: "app/components/HtmlCanvasEditor.tsx",
    snapshot: {
      activeIframePresent: false,
      candidateCreated: 0,
      workingHtmlUpdated: true,
      stableIds: ["block-1"],
    },
  },
  {
    id: "candidate-created-during-edit",
    owner: "runtime-continuity",
    killer: "electron-editing-smoke",
    productionFile: "app/components/HtmlCanvasEditor.tsx",
    snapshot: {
      activeIframePresent: true,
      candidateCreated: 1,
      workingHtmlUpdated: true,
      stableIds: ["block-1"],
    },
  },
  {
    id: "working-html-skipped-before-save",
    owner: "document-workflow",
    killer: "electron-recovery-smoke",
    productionFile: "app/application/document-workflow.js",
    snapshot: {
      activeIframePresent: true,
      candidateCreated: 0,
      workingHtmlUpdated: false,
      saveRequested: true,
      stableIds: ["block-1"],
    },
  },
  {
    id: "duplicate-stable-id",
    owner: "source-editing-core",
    killer: "browser-editing-smoke",
    productionFile: "app/lib/source-patch-engine.js",
    snapshot: {
      activeIframePresent: true,
      candidateCreated: 0,
      workingHtmlUpdated: true,
      stableIds: ["block-1", "block-1"],
    },
  },
];

export function evaluateRuntimeContinuity(snapshot) {
  if (!snapshot?.activeIframePresent) {
    return { passed: false, reason: "active iframe missing" };
  }
  if (Number(snapshot.candidateCreated) > 0) {
    return { passed: false, reason: "candidate created during edit" };
  }
  return { passed: true };
}

export function evaluatePersistence(snapshot) {
  if (snapshot?.saveRequested && snapshot.workingHtmlUpdated !== true) {
    return { passed: false, reason: "working HTML skipped before save" };
  }
  return { passed: true };
}

export function evaluateStableIdAuthority(snapshot) {
  const ids = Array.isArray(snapshot?.stableIds) ? snapshot.stableIds : [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) return { passed: false, reason: "duplicate Stable ID" };
    seen.add(id);
  }
  return { passed: true };
}

export function evaluateSeededFault(faultId, snapshot) {
  if (faultId === "active-iframe-cleared" || faultId === "candidate-created-during-edit") {
    return evaluateRuntimeContinuity(snapshot);
  }
  if (faultId === "working-html-skipped-before-save") {
    return evaluatePersistence(snapshot);
  }
  if (faultId === "duplicate-stable-id") {
    return evaluateStableIdAuthority(snapshot);
  }
  throw new Error(`Unknown seeded fault ${faultId}.`);
}
