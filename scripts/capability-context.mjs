import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const CAPABILITY_CONTEXT_MAP_PATH = path.join(scriptDir, "capability-context.json");

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))].sort();
}

function normalizeRepositoryPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasMarkdownHeading(content, heading) {
  return new RegExp(`^${escapeRegExp(heading)}\\s*$`, "mu").test(content);
}

function listedDomainFiles(domain) {
  return uniqueSorted([
    ...(domain.entryInterfaces || []),
    ...(domain.implementationFiles || []),
    ...(domain.focusedTests || []),
    ...(domain.requiredDocs || []),
    ...((domain.requiredDocSections || []).map((section) => section.path)),
  ]);
}

function emptyReadingSet() {
  return { files: [], estimatedBytes: 0 };
}

function estimateFiles(files, productRoot) {
  const root = path.resolve(productRoot);
  const rootPrefix = `${root}${path.sep}`;
  let estimatedBytes = 0;
  const missingFiles = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (absolute === root || !absolute.startsWith(rootPrefix) || !existsSync(absolute)) {
      missingFiles.push(file);
      continue;
    }
    estimatedBytes += statSync(absolute).size;
  }
  return { estimatedBytes, missingFiles: uniqueSorted(missingFiles) };
}

function readingSet(files, productRoot, extra = {}) {
  const { estimatedBytes, missingFiles } = estimateFiles(files, productRoot);
  return {
    files,
    estimatedBytes,
    ...extra,
    missingFiles,
  };
}

function dropMissing(set) {
  return {
    files: set.files,
    estimatedBytes: set.estimatedBytes,
    ...(set.sections ? { sections: set.sections } : {}),
  };
}

function domainWholeDocFiles(domain) {
  const sectionPaths = new Set(
    (domain.requiredDocSections || []).map((section) => normalizeRepositoryPath(section.path)),
  );
  return (domain.requiredDocs || [])
    .map(normalizeRepositoryPath)
    .filter((docPath) => !sectionPaths.has(docPath));
}

export function mergeRequiredDocSections(domains) {
  const wholeFiles = new Set();
  for (const domain of domains) {
    for (const docPath of domainWholeDocFiles(domain)) wholeFiles.add(docPath);
  }
  const headingsByPath = new Map();
  for (const domain of domains) {
    for (const section of domain.requiredDocSections || []) {
      const docPath = normalizeRepositoryPath(section.path);
      if (wholeFiles.has(docPath)) continue;
      const headings = headingsByPath.get(docPath) || [];
      headings.push(...(section.headings || []));
      headingsByPath.set(docPath, headings);
    }
  }
  return [...headingsByPath.entries()]
    .map(([docPath, headings]) => ({ path: docPath, headings: uniqueSorted(headings) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function assertCapabilityContextMap(map, productRoot) {
  const missingFiles = [];
  const invalidSections = [];
  for (const domain of map.domains) {
    for (const file of listedDomainFiles(domain)) {
      const absolute = path.resolve(productRoot, file);
      if (!existsSync(absolute)) missingFiles.push(`${domain.id}:${file}`);
    }
    for (const section of domain.requiredDocSections || []) {
      const absolute = path.resolve(productRoot, section.path);
      if (!existsSync(absolute)) continue;
      const content = readFileSync(absolute, "utf8");
      for (const heading of section.headings) {
        if (!hasMarkdownHeading(content, heading)) {
          invalidSections.push(`${domain.id}:${section.path}:${heading}`);
        }
      }
    }
  }
  if (missingFiles.length > 0) {
    throw new Error(`Capability-context map references missing files: ${missingFiles.join(", ")}`);
  }
  if (invalidSections.length > 0) {
    throw new Error(
      `Capability-context map references missing doc headings: ${invalidSections.join(", ")}`,
    );
  }
  return map;
}

export function loadCapabilityContextMap(
  mapPath = CAPABILITY_CONTEXT_MAP_PATH,
  { productRoot = path.resolve(scriptDir, ".."), validatePaths = true } = {},
) {
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new TypeError("Capability-context map must be an object.");
  }
  if (map.schemaVersion !== 2) {
    throw new Error("Unsupported capability-context schemaVersion.");
  }
  if (map.defaultLevel !== "contract") {
    throw new Error("Capability-context schema v2 must be contract-first.");
  }
  if (!Array.isArray(map.domains) || map.domains.length === 0) {
    throw new Error("Capability-context map needs domains.");
  }
  const seen = new Set();
  for (const domain of map.domains) {
    if (!domain?.id || !Array.isArray(domain.patterns) || domain.patterns.length === 0) {
      throw new Error("Every capability domain needs an id and patterns.");
    }
    if (seen.has(domain.id)) throw new Error(`Duplicate capability domain ${domain.id}.`);
    seen.add(domain.id);
    for (const pattern of domain.patterns) new RegExp(pattern, "u");
    if (domain.requiredDocSections != null) {
      if (!Array.isArray(domain.requiredDocSections)) {
        throw new Error(`Capability domain ${domain.id} requiredDocSections must be an array.`);
      }
      for (const section of domain.requiredDocSections) {
        if (!section?.path || !Array.isArray(section.headings) || section.headings.length === 0) {
          throw new Error(
            `Capability domain ${domain.id} requiredDocSections need a path and headings.`,
          );
        }
      }
    }
  }
  if (validatePaths) assertCapabilityContextMap(map, productRoot);
  return map;
}

export function emptyCapabilityContext() {
  return {
    domains: [],
    defaultLevel: "contract",
    owners: [],
    contract: emptyReadingSet(),
    implementationFiles: emptyReadingSet(),
    focusedTests: emptyReadingSet(),
    requiredDocs: { ...emptyReadingSet(), sections: [] },
    implementation: emptyReadingSet(),
    unmatchedFiles: [],
    unmatchedDomains: [],
    missingFiles: [],
  };
}

export function selectCapabilityContext({
  changedFiles = [],
  domainIds = [],
  queryFiles = [],
  map,
  productRoot = path.resolve(scriptDir, ".."),
} = {}) {
  if (!map) throw new Error("selectCapabilityContext requires a capability-context map.");
  const fileInputs = uniqueSorted([
    ...changedFiles.map(normalizeRepositoryPath),
    ...queryFiles.map(normalizeRepositoryPath),
  ]);
  const requestedDomainIds = uniqueSorted(domainIds.map((value) => String(value || "").trim()));
  const domainById = new Map(map.domains.map((domain) => [domain.id, domain]));
  const unmatchedDomains = requestedDomainIds.filter((id) => !domainById.has(id));
  const matchedIds = new Set();
  for (const id of requestedDomainIds) {
    if (domainById.has(id)) matchedIds.add(id);
  }
  const unmatchedFiles = [];
  for (const file of fileInputs) {
    const hit = map.domains.filter((domain) => (
      domain.patterns.some((pattern) => new RegExp(pattern, "u").test(file))
    ));
    if (hit.length === 0) unmatchedFiles.push(file);
    for (const domain of hit) matchedIds.add(domain.id);
  }
  const matched = map.domains.filter((domain) => matchedIds.has(domain.id));
  const union = (key) => uniqueSorted(matched.flatMap((domain) => domain[key] || []));
  const entryInterfaces = union("entryInterfaces");
  const owners = union("owners");
  const implementationFiles = union("implementationFiles");
  const focusedTests = union("focusedTests");
  const requiredDocs = union("requiredDocs");
  const sections = mergeRequiredDocSections(matched);
  const implementation = uniqueSorted([
    ...entryInterfaces,
    ...implementationFiles,
    ...focusedTests,
    ...requiredDocs,
  ]);
  const contractSet = readingSet(entryInterfaces, productRoot);
  const implementationFileSet = readingSet(implementationFiles, productRoot);
  const focusedTestSet = readingSet(focusedTests, productRoot);
  const requiredDocSet = readingSet(requiredDocs, productRoot, { sections });
  const implementationSet = readingSet(implementation, productRoot);
  const missingFiles = uniqueSorted([
    ...contractSet.missingFiles,
    ...implementationFileSet.missingFiles,
    ...focusedTestSet.missingFiles,
    ...requiredDocSet.missingFiles,
  ]);
  return {
    domains: matched.map((domain) => domain.id),
    defaultLevel: map.defaultLevel,
    owners,
    contract: dropMissing(contractSet),
    implementationFiles: dropMissing(implementationFileSet),
    focusedTests: dropMissing(focusedTestSet),
    requiredDocs: dropMissing(requiredDocSet),
    implementation: dropMissing(implementationSet),
    unmatchedFiles,
    unmatchedDomains,
    missingFiles,
  };
}
