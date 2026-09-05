// Test/benchmark counters for the edit pipeline. Default off; never a Session,
// never a production event stream, and never include source HTML.
const KIND_TO_TOTAL = {
  sourceIndexBuild: "sourceIndexBuilds",
  fullPatchApply: "fullPatchApplies",
  insertionPointFullTreeScan: "insertionPointFullTreeScans",
};

let enabled = false;
let counts = createCounts();
let events = [];

function createCounts() {
  return {
    sourceIndexBuilds: 0,
    fullDocumentIndexBuilds: 0,
    fragmentIndexBuilds: 0,
    unlabeledIndexBuilds: 0,
    fullPatchApplies: 0,
    insertionPointFullTreeScans: 0,
  };
}

function sanitizeScope(scope) {
  if (scope === "full-document" || scope === "fragment") return scope;
  return "unlabeled";
}

function sanitizeCaller(caller) {
  return typeof caller === "string" && caller.length > 0 && caller.length <= 96
    ? caller
    : "unspecified";
}

function snapshot() {
  return {
    ...counts,
    events: events.map((event) => ({ ...event })),
  };
}

export function editPipelineCountersEnabled() {
  return enabled === true;
}

export function enableEditPipelineCounters() {
  enabled = true;
  return snapshot();
}

export function disableEditPipelineCounters() {
  enabled = false;
  counts = createCounts();
  events = [];
  return snapshot();
}

export function resetEditPipelineCounters() {
  counts = createCounts();
  events = [];
  return snapshot();
}

export function recordEditPipelineCount(kind, details = {}) {
  if (!enabled) return;
  const totalKey = KIND_TO_TOTAL[kind];
  if (!totalKey) return;
  const scope = sanitizeScope(details.scope);
  const caller = sanitizeCaller(details.caller);
  const codeUnitLength = Number.isSafeInteger(details.codeUnitLength) && details.codeUnitLength >= 0
    ? details.codeUnitLength
    : null;
  counts[totalKey] += 1;
  if (kind === "sourceIndexBuild") {
    if (scope === "full-document") counts.fullDocumentIndexBuilds += 1;
    else if (scope === "fragment") counts.fragmentIndexBuilds += 1;
    else counts.unlabeledIndexBuilds += 1;
  }
  events.push({
    kind,
    scope,
    caller,
    ...(codeUnitLength == null ? {} : { codeUnitLength }),
  });
}

export function readEditPipelineCounters() {
  return snapshot();
}

export function installEditPipelineTestHooks(target = typeof window === "undefined" ? null : window) {
  if (!target) return;
  target.__PAGEROOT_ENABLE_EDIT_PIPELINE_COUNTERS__ = () => enableEditPipelineCounters();
  target.__PAGEROOT_DISABLE_EDIT_PIPELINE_COUNTERS__ = () => disableEditPipelineCounters();
  target.__PAGEROOT_RESET_EDIT_PIPELINE_COUNTERS__ = () => resetEditPipelineCounters();
  target.__PAGEROOT_READ_EDIT_PIPELINE_COUNTERS__ = () => readEditPipelineCounters();
}
