import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const RESUME_ENV_KEYS = [
  "CI",
  "NODE_ENV",
  "PAGEROOT_E2E",
  "PAGEROOT_E2E_FOREGROUND",
  "PAGEROOT_REAL_HTML_PATH",
  "PAGEROOT_SOURCE_GATE_TRUSTED",
  "PAGEROOT_SOURCE_GATE_TREE",
  "PAGEROOT_SOURCE_GATE_VERSION",
];

const BUILD_OUTPUTS = {
  "build-web": "dist",
  "build-desktop": "dist-desktop",
};

export function resumeEnvSubset(env = process.env) {
  const subset = {};
  for (const key of RESUME_ENV_KEYS) {
    if (env[key]) subset[key] = env[key];
  }
  return subset;
}

export async function hashFile(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}

export async function hashDirectory(root) {
  const files = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute));
    }
  };
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) return null;
  await walk(root);
  const hash = createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function collectBuildArtifactHashes(productRoot, suiteIds) {
  const hashes = {};
  for (const suiteId of suiteIds) {
    const relative = BUILD_OUTPUTS[suiteId];
    if (!relative) continue;
    hashes[relative] = await hashDirectory(path.join(productRoot, relative));
  }
  return hashes;
}

export function buildGateFingerprint({
  tree,
  changeSetSha256,
  baseRef = null,
  packageLockSha256,
  nodeVersion,
  platform,
  arch,
  suiteCommands,
  envSubset,
  artifactHashes = {},
}) {
  return {
    schemaVersion: 1,
    tree,
    changeSetSha256,
    baseRef: baseRef || null,
    packageLockSha256,
    nodeVersion,
    platform,
    arch,
    suiteCommands,
    envSubset,
    artifactHashes,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintDigest(fingerprint) {
  return `sha256:${createHash("sha256").update(stableStringify(fingerprint)).digest("hex")}`;
}

export function assertResumeCompatible(previous, current) {
  if (!previous || previous.schemaVersion !== 1) {
    throw new Error("Cannot resume: previous fingerprint is missing or unsupported.");
  }
  const fields = [
    "tree",
    "changeSetSha256",
    "baseRef",
    "packageLockSha256",
    "nodeVersion",
    "platform",
    "arch",
    "suiteCommands",
    "envSubset",
  ];
  for (const field of fields) {
    if (stableStringify(previous[field]) !== stableStringify(current[field])) {
      throw new Error(`Cannot resume: ${field} is not identical to the original run.`);
    }
  }
}

export function suitesForResume(selectedSuites, previousResults = []) {
  const byId = new Map(previousResults.map((result) => [result.id, result]));
  return selectedSuites.map((suite) => {
    const previous = byId.get(suite.id);
    if (previous?.status === "passed") {
      return { ...suite, resume: "reuse", previous };
    }
    if (previous?.status === "failed") {
      return { ...suite, resume: "retry", previous };
    }
    return { ...suite, resume: "run", previous: null };
  });
}

export async function assertReusableBuildArtifacts(productRoot, suitePlan) {
  for (const suite of suitePlan) {
    if (suite.resume !== "reuse") continue;
    const relative = BUILD_OUTPUTS[suite.id];
    if (!relative) continue;
    const expected = suite.previous?.outputHash;
    if (!expected) {
      throw new Error(`Cannot resume: ${suite.id} passed without a stored output hash.`);
    }
    const actual = await hashDirectory(path.join(productRoot, relative));
    if (actual !== expected) {
      throw new Error(`Cannot resume: ${relative} no longer matches the passed ${suite.id} output.`);
    }
  }
}

export { BUILD_OUTPUTS, RESUME_ENV_KEYS };
