#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

export const acceptedAdvisories = Object.freeze({
  1122144: Object.freeze({
    url: "https://github.com/advisories/GHSA-fgmj-fm8m-jvvx",
    expiresOn: "2026-11-28",
  }),
});

export function evaluateAuditReport(report, {
  allowlist = acceptedAdvisories,
  now = new Date(),
} = {}) {
  if (!report || typeof report !== "object" || report.error) {
    throw new Error(`npm audit did not return a usable report${report?.error?.summary ? `: ${report.error.summary}` : "."}`);
  }
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (via && typeof via === "object" && Number.isInteger(via.source)) {
        advisories.set(String(via.source), via);
      }
    }
  }
  const unexpected = [...advisories.entries()]
    .filter(([source]) => !allowlist[source])
    .map(([, advisory]) => advisory);
  const expired = [...advisories.keys()]
    .filter((source) => allowlist[source])
    .filter((source) => now >= new Date(`${allowlist[source].expiresOn}T00:00:00.000Z`))
    .map((source) => ({ source, ...allowlist[source] }));
  return Object.freeze({
    advisories: [...advisories.values()],
    unexpected,
    expired,
    passed: unexpected.length === 0 && expired.length === 0,
  });
}

function runtimeResourcePath(value, {
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return String(value || "")
    .replaceAll("${platform}", platform)
    .replaceAll("${arch}", arch);
}

function managedRuntimeModules(packageJson, options) {
  const modules = new Set();
  for (const resource of packageJson?.build?.extraResources || []) {
    const from = runtimeResourcePath(resource?.from, options);
    const to = runtimeResourcePath(resource?.to, options);
    if (
      !from
      || to !== from
    ) {
      continue;
    }
    const match = from.match(
      /^node_modules\/((?:@[^/]+\/)?[^/]+)$/u,
    );
    if (match) modules.add(match[1]);
  }
  return modules;
}

export function evaluatePackagedRuntimeClosure(packageJson, packageLock, options = {}) {
  if (
    !packageJson
    || typeof packageJson !== "object"
    || !packageLock
    || typeof packageLock !== "object"
    || !packageLock.packages
    || typeof packageLock.packages !== "object"
  ) {
    throw new Error("Package manifest and lockfile are required.");
  }
  const managedModules = managedRuntimeModules(packageJson, options);
  const missingPackages = [];
  const missingResources = [];
  const nestedPackages = [];
  for (const moduleName of managedModules) {
    const packagePath = `node_modules/${moduleName}`;
    const lockedPackage = packageLock.packages[packagePath];
    if (!lockedPackage) {
      missingPackages.push(packagePath);
      continue;
    }
    for (const dependencyName of Object.keys(lockedPackage.dependencies || {})) {
      const dependencyPath = `node_modules/${dependencyName}`;
      if (!packageLock.packages[dependencyPath]) {
        missingPackages.push(dependencyPath);
      } else if (!managedModules.has(dependencyName)) {
        missingResources.push(`${moduleName} -> ${dependencyName}`);
      }
    }
    const nestedPrefix = `${packagePath}/node_modules/`;
    for (const lockedPath of Object.keys(packageLock.packages)) {
      if (lockedPath.startsWith(nestedPrefix)) {
        nestedPackages.push(lockedPath);
      }
    }
  }
  return Object.freeze({
    managedModules: Object.freeze([...managedModules].sort()),
    missingPackages: Object.freeze([...new Set(missingPackages)].sort()),
    missingResources: Object.freeze([...new Set(missingResources)].sort()),
    nestedPackages: Object.freeze([...new Set(nestedPackages)].sort()),
    passed: (
      missingPackages.length === 0
      && missingResources.length === 0
      && nestedPackages.length === 0
    ),
  });
}

function runAudit() {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: productRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(`Unable to parse npm audit output: ${result.stderr.trim()}`, { cause });
  }
}

function main() {
  const packageJson = JSON.parse(
    readFileSync(path.join(productRoot, "package.json"), "utf8"),
  );
  const packageLock = JSON.parse(
    readFileSync(path.join(productRoot, "package-lock.json"), "utf8"),
  );
  const runtimeClosure = evaluatePackagedRuntimeClosure(
    packageJson,
    packageLock,
  );
  if (!runtimeClosure.passed) {
    throw new Error(
      [
        runtimeClosure.missingPackages.length > 0
          && `Packaged runtime modules missing from lockfile: ${runtimeClosure.missingPackages.join(", ")}.`,
        runtimeClosure.missingResources.length > 0
          && `Packaged runtime dependencies missing from extraResources: ${runtimeClosure.missingResources.join(", ")}.`,
        runtimeClosure.nestedPackages.length > 0
          && `Packaged runtime dependencies must be hoisted: ${runtimeClosure.nestedPackages.join(", ")}.`,
      ].filter(Boolean).join("\n"),
    );
  }
  const evaluation = evaluateAuditReport(runAudit());
  for (const advisory of evaluation.advisories) {
    const accepted = acceptedAdvisories[String(advisory.source)];
    console.log(
      `Known advisory ${advisory.url} (${advisory.severity}); review by ${accepted?.expiresOn || "now"}.`,
    );
  }
  if (!evaluation.passed) {
    const unexpected = evaluation.unexpected.map((item) => item.url || item.source).join(", ");
    const expired = evaluation.expired.map((item) => `${item.url} expired ${item.expiresOn}`).join(", ");
    throw new Error(
      [
        unexpected && `Unreviewed dependency advisories: ${unexpected}`,
        expired && `Dependency exceptions require review: ${expired}`,
      ].filter(Boolean).join("\n"),
    );
  }
  console.log(
    `Dependency audit policy passed; ${runtimeClosure.managedModules.length} packaged runtime module(s) form one hoisted closure and no unreviewed advisory is present.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
