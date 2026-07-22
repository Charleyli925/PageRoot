import path from "node:path";

const CODE_PATH = /\.(?:cjs|mjs|js|jsx|ts|tsx|json)$/iu;
const NODE_TEST_PATH = /^tests\/[^/]+\.test\.mjs$/u;

export function normalizeRepositoryPath(value) {
  return String(value).replaceAll(path.sep, "/").replace(/^\.\//u, "");
}

export function validateImpactMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new TypeError("Test impact map must be an object.");
  }
  if (map.schemaVersion !== 1) throw new Error("Unsupported test impact map schemaVersion.");
  const suiteIds = new Set(Object.keys(map.suites || {}));
  if (suiteIds.size === 0) throw new Error("Test impact map has no suites.");
  for (const [suiteId, suite] of Object.entries(map.suites)) {
    for (const prerequisite of suite.prerequisites || []) {
      if (!suiteIds.has(prerequisite)) {
        throw new Error(`Suite ${suiteId} has unknown prerequisite ${prerequisite}.`);
      }
    }
  }
  for (const [laneId, lane] of Object.entries(map.lanes || {})) {
    for (const suiteId of [
      ...(lane.allowedSuites || []),
      ...(lane.alwaysForCode || []),
      ...(lane.fullSuites || []),
    ]) {
      if (!suiteIds.has(suiteId)) throw new Error(`Lane ${laneId} references unknown suite ${suiteId}.`);
    }
  }
  for (const rule of map.rules || []) {
    if (!rule.id || !Array.isArray(rule.patterns)) throw new Error("Every impact rule needs an id and patterns.");
    for (const pattern of rule.patterns) new RegExp(pattern, "u");
    for (const suiteId of rule.suites || []) {
      if (!suiteIds.has(suiteId)) throw new Error(`Rule ${rule.id} references unknown suite ${suiteId}.`);
    }
  }
  return map;
}

function addReason(reasons, suiteId, reason) {
  const entries = reasons.get(suiteId) || [];
  if (!entries.includes(reason)) entries.push(reason);
  reasons.set(suiteId, entries);
}

function expandPrerequisites(map, requestedSuiteIds, reasons) {
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  const visit = (suiteId) => {
    if (visited.has(suiteId)) return;
    if (visiting.has(suiteId)) throw new Error(`Cyclic test prerequisite at ${suiteId}.`);
    visiting.add(suiteId);
    for (const prerequisite of map.suites[suiteId].prerequisites || []) {
      addReason(reasons, prerequisite, `required by ${suiteId}`);
      visit(prerequisite);
    }
    visiting.delete(suiteId);
    visited.add(suiteId);
    ordered.push(suiteId);
  };
  requestedSuiteIds.forEach(visit);
  return ordered;
}

function orderForFastFailure(suiteIds, selectedNodeTests) {
  const webBackedNode = suiteIds.includes("node-full")
    || suiteIds.includes("node-integration")
    || selectedNodeTests.includes("tests/rendered-html.test.mjs");
  const phase = (suiteId) => {
    if (suiteId === "typecheck") return 10;
    if (suiteId === "lint") return 20;
    if (suiteId === "dependency-audit") return 25;
    if (suiteId.startsWith("node-")) return webBackedNode ? 40 : 30;
    if (suiteId === "build-web") return webBackedNode ? 30 : 40;
    if (suiteId.startsWith("browser-")) return 50;
    if (suiteId === "real-html") return 55;
    if (suiteId === "build-desktop") return 60;
    if (suiteId.startsWith("electron-")) return 70;
    if (suiteId === "ai-closed-loop" || suiteId === "ai-smoke") return 80;
    if (suiteId === "package-build") return 90;
    if (suiteId === "packaged-runtime") return 100;
    if (suiteId === "packaged-verify") return 110;
    return 45;
  };
  return suiteIds
    .map((id, index) => ({ id, index }))
    .sort((left, right) => phase(left.id) - phase(right.id) || left.index - right.index)
    .map(({ id }) => id);
}

export function selectGatePlan({ map, lane, changedFiles = [] }) {
  validateImpactMap(map);
  const laneConfig = map.lanes?.[lane];
  if (!laneConfig) throw new Error(`Unknown test lane ${JSON.stringify(lane)}.`);
  const normalizedFiles = [...new Set(changedFiles.map(normalizeRepositoryPath))].sort();
  const reasons = new Map();
  const requested = [];
  const requestedSet = new Set();
  const selectedNodeTests = new Set();
  const fallbackReasons = [];
  const addSuite = (suiteId, reason) => {
    if (!map.suites[suiteId]) throw new Error(`Unknown selected suite ${suiteId}.`);
    addReason(reasons, suiteId, reason);
    if (!requestedSet.has(suiteId)) {
      requestedSet.add(suiteId);
      requested.push(suiteId);
    }
  };

  if (Array.isArray(laneConfig.fullSuites)) {
    laneConfig.fullSuites.forEach((suiteId) => addSuite(suiteId, `${lane} lane`));
  } else {
    const allowed = new Set(laneConfig.allowedSuites || []);
    const isCodeChange = normalizedFiles.some((file) => CODE_PATH.test(file));
    if (isCodeChange) {
      for (const suiteId of laneConfig.alwaysForCode || []) addSuite(suiteId, "code changed");
    }

    for (const file of normalizedFiles) {
      const isTopLevelNodeTest = NODE_TEST_PATH.test(file);
      if (isTopLevelNodeTest) {
        selectedNodeTests.add(file);
        if (allowed.has("node-targeted")) addSuite("node-targeted", `${file} changed`);
      }
      let matched = isTopLevelNodeTest;
      for (const rule of map.rules || []) {
        if (!rule.patterns.some((pattern) => new RegExp(pattern, "u").test(file))) continue;
        matched = true;
        for (const nodeTest of rule.nodeTests || []) selectedNodeTests.add(nodeTest);
        for (const suiteId of rule.suites || []) {
          if (allowed.has(suiteId)) addSuite(suiteId, `${rule.id}: ${file}`);
        }
      }
      if (matched && selectedNodeTests.size > 0 && allowed.has("node-targeted")) {
        addSuite("node-targeted", `impact-mapped Node tests for ${file}`);
      }
      const fallbackPattern = new RegExp(map.fallback?.codePattern || CODE_PATH.source, "u");
      if (!matched && fallbackPattern.test(file)) {
        fallbackReasons.push(`unmapped code fallback: ${file}`);
      }
    }
    if (selectedNodeTests.size === 0 && fallbackReasons.length > 0) {
      for (const suiteId of map.fallback?.suites || []) {
        if (!allowed.has(suiteId)) continue;
        for (const reason of fallbackReasons) addSuite(suiteId, reason);
      }
    }
    if (selectedNodeTests.has("tests/rendered-html.test.mjs")) {
      addSuite("build-web", "tests/rendered-html.test.mjs imports the production server build");
      const buildIndex = requested.indexOf("build-web");
      const targetedIndex = requested.indexOf("node-targeted");
      if (buildIndex > targetedIndex && targetedIndex >= 0) {
        requested.splice(buildIndex, 1);
        requested.splice(targetedIndex, 0, "build-web");
      }
    }
  }

  if (selectedNodeTests.size === 0 && requestedSet.has("node-targeted")) {
    requestedSet.delete("node-targeted");
    const index = requested.indexOf("node-targeted");
    if (index >= 0) requested.splice(index, 1);
    reasons.delete("node-targeted");
  }

  const suiteIds = orderForFastFailure(
    expandPrerequisites(map, requested, reasons),
    [...selectedNodeTests],
  );
  return {
    lane,
    changedFiles: normalizedFiles,
    selectedNodeTests: [...selectedNodeTests].sort(),
    suites: suiteIds.map((id) => ({
      id,
      description: map.suites[id].description,
      reasons: reasons.get(id) || [],
    })),
  };
}

export function assertFullyAutomatedPlan(plan) {
  const prohibited = /(?:manual|human|人工|真人|手工|checklist)/iu;
  for (const suite of plan.suites) {
    if (prohibited.test(`${suite.id} ${suite.description}`)) {
      throw new Error(`Interactive test suite is prohibited: ${suite.id}`);
    }
  }
  return plan;
}
