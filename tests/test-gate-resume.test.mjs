import assert from "node:assert/strict";
import test from "node:test";

import {
  assertResumeCompatible,
  buildGateFingerprint,
  fingerprintDigest,
  suitesForResume,
} from "../scripts/test-gate-resume.mjs";

function fingerprint(overrides = {}) {
  return buildGateFingerprint({
    tree: "tree-a",
    changeSetSha256: "sha256:change-a",
    baseRef: "origin/main",
    packageLockSha256: "sha256:lock-a",
    nodeVersion: "v22.13.0",
    platform: "darwin",
    arch: "arm64",
    suiteCommands: [
      { id: "typecheck", command: "npm run typecheck" },
      { id: "electron-editing-smoke", command: "npx playwright test --grep @smoke-editing" },
    ],
    envSubset: { CI: "true" },
    artifactHashes: { "dist-desktop": "sha256:dist-a" },
    ...overrides,
  });
}

test("identical source fingerprints are reusable", () => {
  const left = fingerprint();
  const right = fingerprint();
  assert.equal(fingerprintDigest(left), fingerprintDigest(right));
  assert.doesNotThrow(() => assertResumeCompatible(left, right));
});

test("a dirty change-set or base ref cannot resume a previous gate", () => {
  const previous = fingerprint();
  assert.throws(
    () => assertResumeCompatible(previous, fingerprint({ changeSetSha256: "sha256:change-b" })),
    /changeSetSha256/u,
  );
  assert.throws(
    () => assertResumeCompatible(previous, fingerprint({ baseRef: "origin/other" })),
    /baseRef/u,
  );
  assert.throws(
    () => assertResumeCompatible(previous, fingerprint({ tree: "tree-b" })),
    /tree/u,
  );
});

test("resume retries the failed suite and reuses earlier passes", () => {
  const plan = suitesForResume(
    [
      { id: "typecheck", command: "npm run typecheck" },
      { id: "node-targeted", command: "node --test" },
      { id: "electron-editing-smoke", command: "npx playwright test" },
    ],
    [
      { id: "typecheck", status: "passed", outputHash: "sha256:ok" },
      { id: "node-targeted", status: "passed" },
      { id: "electron-editing-smoke", status: "failed", exitCode: 1 },
    ],
  );
  assert.deepEqual(plan.map((suite) => [suite.id, suite.resume]), [
    ["typecheck", "reuse"],
    ["node-targeted", "reuse"],
    ["electron-editing-smoke", "retry"],
  ]);
});
