#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

export const acceptedAdvisories = Object.freeze({
  1124334: Object.freeze({
    package: "brace-expansion",
    url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
    expiresOn: "2026-08-15",
  }),
  1124066: Object.freeze({
    package: "sharp",
    url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
    expiresOn: "2026-08-31",
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
  console.log("Dependency audit policy passed; no unreviewed advisory is present.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
