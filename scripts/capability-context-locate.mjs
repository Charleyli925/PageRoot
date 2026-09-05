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
    expectedContractFiles: ["app/domain/edit-runtime-contract.d.ts"],
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

function fileBytes(productRoot, file) {
  return statSync(path.join(productRoot, file)).size;
}

function filesBytes(productRoot, files) {
  return files.reduce((total, file) => total + fileBytes(productRoot, file), 0);
}

export function scopedDocBytes(requiredDocs, productRoot) {
  const sectionBytesByPath = new Map();
  for (const section of requiredDocs.sections || []) {
    const content = readFileSync(path.join(productRoot, section.path), "utf8");
    const total = (section.headings || []).reduce(
      (sum, heading) => sum + markdownSectionBytes(content, heading),
      0,
    );
    sectionBytesByPath.set(section.path, total);
  }
  let estimatedBytes = 0;
  for (const file of requiredDocs.files || []) {
    estimatedBytes += sectionBytesByPath.has(file)
      ? sectionBytesByPath.get(file)
      : fileBytes(productRoot, file);
  }
  return estimatedBytes;
}

function firstLocateBytes(context, productRoot) {
  return context.contract.estimatedBytes + scopedDocBytes(context.requiredDocs, productRoot);
}

function summarizeContext(context, productRoot) {
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
    scopedDocBytes: context.requiredDocs
      ? scopedDocBytes(context.requiredDocs, productRoot)
      : 0,
    firstLocateBytes: firstLocateBytes({
      ...context,
      requiredDocs: context.requiredDocs || { files: [], sections: [] },
    }, productRoot),
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
  impactMap,
} = {}) {
  const resolvedBeforeMap = beforeMap || loadCapabilityContextMap(BEFORE_MAP_FIXTURE, {
    productRoot,
  });
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
    const legacyBytes = filesBytes(productRoot, task.legacyDisclosureFiles);
    const after = summarizeContext(afterByDomain, productRoot);
    const before = summarizeContext(beforeByFile, productRoot);
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
