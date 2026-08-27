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

export function loadCapabilityContextMap(mapPath = CAPABILITY_CONTEXT_MAP_PATH) {
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new TypeError("Capability-context map must be an object.");
  }
  if (map.schemaVersion !== 1) {
    throw new Error("Unsupported capability-context schemaVersion.");
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
  }
  return map;
}

export function emptyCapabilityContext() {
  return {
    domains: [],
    entryInterfaces: [],
    owners: [],
    implementationFiles: [],
    focusedTests: [],
    requiredDocs: [],
    estimatedContextBytes: 0,
  };
}

export function selectCapabilityContext({
  changedFiles = [],
  map,
  productRoot = path.resolve(scriptDir, ".."),
} = {}) {
  if (!map) throw new Error("selectCapabilityContext requires a capability-context map.");
  const normalized = uniqueSorted(changedFiles.map(normalizeRepositoryPath));
  const matched = [];
  for (const domain of map.domains) {
    const regexes = domain.patterns.map((pattern) => new RegExp(pattern, "u"));
    if (normalized.some((file) => regexes.some((regex) => regex.test(file)))) {
      matched.push(domain);
    }
  }
  const union = (key) => uniqueSorted(matched.flatMap((domain) => domain[key] || []));
  const entryInterfaces = union("entryInterfaces");
  const owners = union("owners");
  const implementationFiles = union("implementationFiles");
  const focusedTests = union("focusedTests");
  const requiredDocs = union("requiredDocs");
  const readingSet = uniqueSorted([
    ...entryInterfaces,
    ...implementationFiles,
    ...focusedTests,
    ...requiredDocs,
  ]);
  const root = path.resolve(productRoot);
  const rootPrefix = `${root}${path.sep}`;
  let estimatedContextBytes = 0;
  for (const file of readingSet) {
    const absolute = path.resolve(root, file);
    if (absolute !== root && !absolute.startsWith(rootPrefix)) continue;
    if (!existsSync(absolute)) continue;
    estimatedContextBytes += statSync(absolute).size;
  }
  return {
    domains: matched.map((domain) => domain.id),
    entryInterfaces,
    owners,
    implementationFiles,
    focusedTests,
    requiredDocs,
    estimatedContextBytes,
  };
}
