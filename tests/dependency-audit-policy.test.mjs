import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acceptedAdvisories,
  createDependencyAuditSnapshot,
  evaluateAuditReport,
  evaluatePackagedRuntimeClosure,
  verifyDependencyAuditSnapshot,
} from "../scripts/check-dependency-audit.mjs";

const dependabotConfig = await readFile(
  new URL("../.github/dependabot.yml", import.meta.url),
  "utf8",
);

function report(...advisories) {
  return {
    vulnerabilities: {
      fixture: {
        via: advisories,
      },
    },
  };
}

test("dependency audit policy accepts reviewed advisories before expiry", () => {
  const result = evaluateAuditReport(report({
    source: 1,
    url: "https://example.test/advisory-1",
    severity: "high",
  }), {
    allowlist: {
      1: { url: "https://example.test/advisory-1", expiresOn: "2026-08-31" },
    },
    now: new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(result.passed, true);
});

test("dependency audit policy rejects new and expired advisories", () => {
  const allowlist = {
    1: { url: "https://example.test/advisory-1", expiresOn: "2026-07-01" },
  };
  const result = evaluateAuditReport(report(
    { source: 1, url: "https://example.test/advisory-1", severity: "high" },
    { source: 2, url: "https://example.test/advisory-2", severity: "moderate" },
  ), {
    allowlist,
    now: new Date("2026-07-23T00:00:00.000Z"),
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.unexpected.map((item) => item.source), [2]);
  assert.deepEqual(result.expired.map((item) => item.source), ["1"]);
});

test("the ECharts 5.6.0 CDN pin has a dated XSS exception", () => {
  assert.deepEqual(acceptedAdvisories, {
    1122144: {
      url: "https://github.com/advisories/GHSA-fgmj-fm8m-jvvx",
      expiresOn: "2026-11-28",
    },
  });
});

test("Dependabot keeps coupled React updates together and defers automatic majors", () => {
  assert.match(
    dependabotConfig,
    /react-stack:[\s\S]*patterns:[\s\S]*- react\n[\s\S]*- react-dom\n[\s\S]*- react-server-dom-webpack/,
  );
  assert.match(
    dependabotConfig,
    /dependency-name: "\*"[\s\S]*update-types:[\s\S]*- version-update:semver-major/,
  );
});

test("packaged runtime dependencies form one explicit hoisted closure", () => {
  const packageJson = {
    build: {
      extraResources: [
        { from: "node_modules/parse5", to: "node_modules/parse5" },
        { from: "node_modules/entities", to: "node_modules/entities" },
      ],
    },
  };
  const alignedLock = {
    packages: {
      "": {},
      "node_modules/parse5": {
        dependencies: { entities: "^8.0.0" },
      },
      "node_modules/entities": {},
    },
  };
  assert.deepEqual(
    evaluatePackagedRuntimeClosure(packageJson, alignedLock),
    {
      managedModules: ["entities", "parse5"],
      missingPackages: [],
      missingResources: [],
      nestedPackages: [],
      passed: true,
    },
  );

  const splitLock = structuredClone(alignedLock);
  splitLock.packages["node_modules/parse5/node_modules/entities"] = {};
  const split = evaluatePackagedRuntimeClosure(packageJson, splitLock);
  assert.equal(split.passed, false);
  assert.deepEqual(split.nestedPackages, [
    "node_modules/parse5/node_modules/entities",
  ]);

  const incompletePackage = structuredClone(packageJson);
  incompletePackage.build.extraResources.pop();
  const incomplete = evaluatePackagedRuntimeClosure(
    incompletePackage,
    alignedLock,
  );
  assert.equal(incomplete.passed, false);
  assert.deepEqual(incomplete.missingResources, ["parse5 -> entities"]);

  const missingLock = structuredClone(alignedLock);
  delete missingLock.packages["node_modules/entities"];
  const missing = evaluatePackagedRuntimeClosure(packageJson, missingLock);
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missingPackages, ["node_modules/entities"]);
});

test("packaged runtime closure resolves the selected platform and architecture macros", () => {
  const packageJson = {
    build: {
      extraResources: [{
        from: "node_modules/@openai/codex-darwin-${arch}",
        to: "node_modules/@openai/codex-darwin-${arch}",
      }],
    },
  };
  const packageLock = {
    packages: {
      "": {},
      "node_modules/@openai/codex-darwin-arm64": {},
    },
  };
  assert.deepEqual(
    evaluatePackagedRuntimeClosure(packageJson, packageLock, {
      platform: "darwin",
      arch: "arm64",
    }),
    {
      managedModules: ["@openai/codex-darwin-arm64"],
      missingPackages: [],
      missingResources: [],
      nestedPackages: [],
      passed: true,
    },
  );
});

test("a later attestation only rechecks the lockfile snapshot instead of auditing twice", () => {
  const snapshot = createDependencyAuditSnapshot({
    packageLockText: '{"lockfileVersion":3}',
    packageJsonText: '{"name":"pageroot"}',
    now: new Date("2026-09-05T00:00:00.000Z"),
  });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(
    verifyDependencyAuditSnapshot(snapshot, {
      packageLockText: '{"lockfileVersion":3}',
      packageJsonText: '{"name":"pageroot"}',
    }),
    true,
  );
  assert.throws(
    () => verifyDependencyAuditSnapshot(snapshot, {
      packageLockText: '{"lockfileVersion":2}',
      packageJsonText: '{"name":"pageroot"}',
    }),
    /package-lock\.json changed/u,
  );
});
