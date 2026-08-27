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
  }
  return map;
}

export function emptyCapabilityContext() {
  return {
    domains: [],
    defaultLevel: "contract",
    owners: [],
    contract: { files: [], estimatedBytes: 0 },
    implementation: { files: [], estimatedBytes: 0 },
  };
}

function estimatedBytes(files, productRoot) {
  const root = path.resolve(productRoot);
  const rootPrefix = `${root}${path.sep}`;
  let total = 0;
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (absolute !== root && !absolute.startsWith(rootPrefix)) continue;
    if (!existsSync(absolute)) continue;
    total += statSync(absolute).size;
  }
  return total;
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
  const implementation = uniqueSorted([
    ...entryInterfaces,
    ...implementationFiles,
    ...focusedTests,
    ...requiredDocs,
  ]);
  return {
    domains: matched.map((domain) => domain.id),
    defaultLevel: map.defaultLevel,
    owners,
    contract: {
      files: entryInterfaces,
      estimatedBytes: estimatedBytes(entryInterfaces, productRoot),
    },
    implementation: {
      files: implementation,
      estimatedBytes: estimatedBytes(implementation, productRoot),
    },
  };
}
