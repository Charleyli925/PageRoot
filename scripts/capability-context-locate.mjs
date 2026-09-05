import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCapabilityContextMap,
  selectCapabilityContext,
} from "./capability-context.mjs";
import { selectGatePlan, validateImpactMap } from "./test-gate-core.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const PRODUCT_ROOT = path.resolve(scriptDir, "..");
export const BEFORE_MAP_FIXTURE = path.join(
  PRODUCT_ROOT,
  "tests/fixtures/capability-context/main-before-cold-start.json",
);
export const BEFORE_SIZES_FIXTURE = path.join(
  PRODUCT_ROOT,
  "tests/fixtures/capability-context/main-before-cold-start.sizes.json",
);

const COMPLETE_MATRIX_SUITES = new Set([
  "node-full",
  "browser-full",
  "electron-full",
  "ai-closed-loop",
  "package-build",
  "packaged-runtime",
  "packaged-verify",
]);

export const LOCATE_TASKS = [
  {
    id: "comments-layout",
    label: "评论布局",
    domainIds: ["comments"],
    probeFile: "app/workbench/comment-rail-container.tsx",
    expectedOwners: ["CommentSession", "CommentWorkflow"],
    expectedContractFiles: ["app/workbench/comment-rail-contract.ts"],
    legacyDisclosureFiles: [
      "docs/ARCHITECTURE_MAP.md",
      "docs/ARCHITECTURE_CONTRACT.md",
      "docs/GUARD_LEDGER.md",
      "docs/INTERACTION_FLOW.md",
    ],
  },
  {
    id: "semantic-editing",
    label: "语义编辑",
    domainIds: ["semantic-source-editing"],
    probeFile: "app/lib/source-structure-edit.js",
    expectedOwners: ["SemanticOperationKernel"],
    expectedContractFiles: [
      "app/lib/source-structure-edit.d.ts",
      "app/components/html-canvas-structure-commands.ts",
    ],
    legacyDisclosureFiles: [
      "docs/ARCHITECTURE.md",
      "docs/ARCHITECTURE_CONTRACT.md",
      "docs/STATE_OWNERSHIP.md",
      "docs/ENGINEERING_STANDARDS.md",
      "docs/SECURITY_MODEL.md",
    ],
  },
  {
    id: "runtime-continuity",
    label: "Runtime 连续性",
    domainIds: ["canvas-runtime"],
    probeFile: "app/domain/edit-runtime-contract.js",
    expectedOwners: ["EditAuthorRuntimeSession"],
    expectedContractFiles: [
      "app/domain/edit-runtime-contract.d.ts",
      "app/components/edit-runtime-refresh-decision.d.ts",
    ],
    legacyDisclosureFiles: [
      "docs/ARCHITECTURE_MAP.md",
      "docs/INTERACTION_FLOW.md",
      "app/components/HtmlCanvasEditor.tsx",
    ],
  },
  {
    id: "ai-candidate",
    label: "AI Candidate",
    domainIds: ["run-and-review"],
    probeFile: "app/application/version-workflow.js",
    expectedOwners: ["VersionWorkflow", "RunWorkflow"],
    expectedContractFiles: ["app/application/version-workflow.d.ts"],
    legacyDisclosureFiles: [
      "docs/ARCHITECTURE_MAP.md",
      "docs/CHANGE_REQUEST_PROTOCOL.md",
      "docs/INTERACTION_FLOW.md",
    ],
  },
  {
    id: "docs-only",
    label: "纯文档修改",
    domainIds: ["architecture-policy"],
    probeFile: "docs/ARCHITECTURE_MAP.md",
    expectedOwners: ["architecture-gate"],
    expectedContractFiles: ["docs/ARCHITECTURE_MAP.md"],
    legacyDisclosureFiles: [
      "docs/ARCHITECTURE.md",
      "docs/ARCHITECTURE_CONTRACT.md",
      "docs/STATE_OWNERSHIP.md",
      "docs/ENGINEERING_STANDARDS.md",
      "docs/SECURITY_MODEL.md",
    ],
  },
];

export function markdownSectionBytes(content, heading) {
  const lines = String(content).split("\n");
  const marker = String(heading).match(/^(#+)/u)?.[1] || "#";
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return 0;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const next = lines[index].match(/^(#+)\s/u);
    if (next && next[1].length <= marker.length) {
      end = index;
      break;
    }
  }
  return Buffer.byteLength(lines.slice(start, end).join("\n"), "utf8");
}

function lookupFrozenBytes(file, frozenSizes) {
  return Object.prototype.hasOwnProperty.call(frozenSizes, file) ? frozenSizes[file] : 0;
}

function currentFileBytes(productRoot, file) {
  try {
    return statSync(path.join(productRoot, file)).size;
  } catch {
    return 0;
  }
}

function currentSectionBytes(productRoot, file, headings) {
  try {
    const content = readFileSync(path.join(productRoot, file), "utf8");
    return (headings || []).reduce(
      (sum, heading) => sum + markdownSectionBytes(content, heading),
      0,
    );
  } catch {
    return 0;
  }
}

export function uniquePresetLocateBytes({
  contractFiles = [],
  requiredDocs = { files: [], sections: [] },
  wholeFileBytes,
  sectionBytes,
}) {
  const counted = new Set();
  let firstLocateBytes = 0;
  let uniqueDocBytes = 0;
  for (const file of contractFiles) {
    if (counted.has(file)) continue;
    counted.add(file);
    firstLocateBytes += wholeFileBytes(file);
  }
  const headingsByPath = new Map(
    (requiredDocs.sections || []).map((section) => [section.path, section.headings || []]),
  );
  for (const file of requiredDocs.files || []) {
    if (counted.has(file)) continue;
    counted.add(file);
    const headings = headingsByPath.get(file);
    const fileBytes = headings
      ? sectionBytes(file, headings)
      : wholeFileBytes(file);
    uniqueDocBytes += fileBytes;
    firstLocateBytes += fileBytes;
  }
  return { firstLocateBytes, uniqueDocBytes };
}

export function scopedDocBytes(requiredDocs, productRoot) {
  return uniquePresetLocateBytes({
    contractFiles: [],
    requiredDocs,
    wholeFileBytes: (file) => currentFileBytes(productRoot, file),
    sectionBytes: (file, headings) => currentSectionBytes(productRoot, file, headings),
  }).uniqueDocBytes;
}

function currentPresetLocateBytes(context, productRoot) {
  return uniquePresetLocateBytes({
    contractFiles: context.contract?.files || [],
    requiredDocs: context.requiredDocs || { files: [], sections: [] },
    wholeFileBytes: (file) => currentFileBytes(productRoot, file),
    sectionBytes: (file, headings) => currentSectionBytes(productRoot, file, headings),
  });
}

function historicalPresetLocateBytes(context, frozenSizes) {
  return uniquePresetLocateBytes({
    contractFiles: context.contract?.files || [],
    requiredDocs: {
      files: context.requiredDocs?.files || [],
      sections: [],
    },
    wholeFileBytes: (file) => lookupFrozenBytes(file, frozenSizes),
    sectionBytes: () => 0,
  });
}

function loadFrozenSizes(sizesPath = BEFORE_SIZES_FIXTURE) {
  return JSON.parse(readFileSync(sizesPath, "utf8"));
}

function summarizeCurrentContext(context, productRoot) {
  const preset = currentPresetLocateBytes(context, productRoot);
  return {
    domains: context.domains,
    owners: context.owners,
    located: context.domains.length > 0,
    unmatchedFiles: context.unmatchedFiles,
    unmatchedDomains: context.unmatchedDomains,
    contractFiles: context.contract.files.length,
    contractBytes: context.contract.estimatedBytes,
    implementationFiles: context.implementationFiles?.files?.length
      ?? context.implementation.files.length,
    implementationBytes: context.implementation.estimatedBytes,
    focusedTests: context.focusedTests?.files || [],
    requiredDocFiles: context.requiredDocs?.files || [],
    requiredDocSections: context.requiredDocs?.sections || [],
    scopedDocBytes: preset.uniqueDocBytes,
    firstLocateBytes: preset.firstLocateBytes,
    includesHtmlCanvasEditor: (context.implementation.files || []).includes(
      "app/components/HtmlCanvasEditor.tsx",
    ),
    includesProjectFileRepository: (context.implementation.files || []).includes(
      "bridge/project-file-repository.mjs",
    ),
    includesStateOwnership: (context.requiredDocs?.files || context.implementation.files || [])
      .includes("docs/STATE_OWNERSHIP.md"),
    includesSecurityModel: (context.requiredDocs?.files || context.implementation.files || [])
      .includes("docs/SECURITY_MODEL.md"),
  };
}

function summarizeHistoricalContext(context, frozenSizes) {
  const preset = historicalPresetLocateBytes(context, frozenSizes);
  return {
    domains: context.domains,
    owners: context.owners,
    located: context.domains.length > 0,
    firstLocateBytes: preset.firstLocateBytes,
    implementationBytes: (context.implementation?.files || []).reduce(
      (sum, file) => sum + lookupFrozenBytes(file, frozenSizes),
      0,
    ),
  };
}

function gateSuitesForProbe(impactMap, probeFile) {
  const plan = selectGatePlan({
    map: impactMap,
    lane: "task",
    changedFiles: [probeFile],
  });
  return {
    suites: plan.suites.map((suite) => suite.id),
    nodeTests: plan.selectedNodeTests,
    selectsCompleteMatrix: plan.suites.some((suite) => COMPLETE_MATRIX_SUITES.has(suite.id)),
  };
}

export function compareLocateTasks({
  productRoot = PRODUCT_ROOT,
  currentMap = loadCapabilityContextMap(),
  beforeMap,
  frozenSizes,
  impactMap,
} = {}) {
  const resolvedBeforeMap = beforeMap || loadCapabilityContextMap(BEFORE_MAP_FIXTURE, {
    productRoot,
    validatePaths: false,
  });
  const resolvedFrozenSizes = frozenSizes || loadFrozenSizes();
  const resolvedImpactMap = impactMap || validateImpactMap(JSON.parse(
    readFileSync(path.join(productRoot, "tests/test-impact-map.json"), "utf8"),
  ));
  return LOCATE_TASKS.map((task) => {
    const afterByDomain = selectCapabilityContext({
      domainIds: task.domainIds,
      map: currentMap,
      productRoot,
    });
    const afterByFile = selectCapabilityContext({
      queryFiles: [task.probeFile],
      map: currentMap,
      productRoot,
    });
    const beforeByFile = selectCapabilityContext({
      changedFiles: [task.probeFile],
      map: resolvedBeforeMap,
      productRoot,
    });
    const legacyBytes = task.legacyDisclosureFiles.reduce(
      (sum, file) => sum + lookupFrozenBytes(file, resolvedFrozenSizes),
      0,
    );
    const after = summarizeCurrentContext(afterByDomain, productRoot);
    const before = summarizeHistoricalContext(beforeByFile, resolvedFrozenSizes);
    const gate = gateSuitesForProbe(resolvedImpactMap, task.probeFile);
    const ownerHit = task.expectedOwners.every((owner) => after.owners.includes(owner));
    const contractHit = task.expectedContractFiles.every((file) => (
      afterByDomain.contract.files.includes(file)
    ));
    const probeMapped = afterByFile.domains.some((domain) => task.domainIds.includes(domain));
    return {
      id: task.id,
      label: task.label,
      probeFile: task.probeFile,
      domainIds: task.domainIds,
      beforeLocated: before.located,
      afterLocated: after.located,
      ownerHit,
      contractHit,
      probeMapped,
      beforeDomains: before.domains,
      afterDomains: after.domains,
      beforeFirstLocateBytes: before.located ? before.firstLocateBytes : legacyBytes,
      afterFirstLocateBytes: after.firstLocateBytes,
      legacyDisclosureBytes: legacyBytes,
      beforeImplementationBytes: before.implementationBytes,
      afterImplementationBytes: after.implementationBytes,
      afterContractBytes: after.contractBytes,
      afterScopedDocBytes: after.scopedDocBytes,
      savedVersusLegacyBytes: Math.max(0, legacyBytes - after.firstLocateBytes),
      includesHtmlCanvasEditor: after.includesHtmlCanvasEditor,
      includesProjectFileRepository: after.includesProjectFileRepository,
      includesStateOwnership: after.includesStateOwnership,
      includesSecurityModel: after.includesSecurityModel,
      gate,
    };
  });
}

export function locateSummary(rows = compareLocateTasks()) {
  const locatedAfter = rows.filter((row) => row.afterLocated).length;
  const locatedBefore = rows.filter((row) => row.beforeLocated).length;
  const ownerHits = rows.filter((row) => row.ownerHit && row.contractHit).length;
  const completeMatrix = rows.filter((row) => row.gate.selectsCompleteMatrix).length;
  const legacyBytes = rows.reduce((sum, row) => sum + row.legacyDisclosureBytes, 0);
  const afterBytes = rows.reduce((sum, row) => sum + row.afterFirstLocateBytes, 0);
  return {
    taskCount: rows.length,
    locatedBefore,
    locatedAfter,
    ownerHits,
    completeMatrixSelections: completeMatrix,
    legacyDisclosureBytes: legacyBytes,
    afterFirstLocateBytes: afterBytes,
    savedVersusLegacyBytes: Math.max(0, legacyBytes - afterBytes),
    rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(locateSummary(), null, 2));
}
