import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { FROZEN_SCENARIO_DEFINITIONS } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./e2e/electron/real-html/workspace-provenance.mjs";
import { digestFrozenEntry } from "./e2e/electron/real-html/frozen-entry-contract.mjs";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "tests/e2e/electron/frozen-html-scenarios.mjs");

function run(args, env = process.env) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

test("frozen scenario list is available without building or starting Electron", () => {
  const result = run(["--list"]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scenarios.map(({ id }) => id), ["A", "B", "C"]);
  assert.match(output.note, /does not start Electron/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /desktop:renderer/u);
});

test("preflight requires an explicit corpus and does not fall back to discovery", () => {
  const env = { ...process.env };
  delete env.STEMMIO_REAL_HTML_DIR;
  const result = run(["--preflight"], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FROZEN_ENTRY_CORPUS_REQUIRED/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /AUTOMATIC_DISCOVERY_EXECUTION/u);
});

test("plan validation fails before renderer build when a nested manifest is missing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-frozen-entry-test-"));
  const current = workspaceSourceFingerprint(root);
  const plan = {
    schemaVersion: 1,
    kind: "stemmio-frozen-scenario-plan",
    reviewStatus: "FROZEN",
    reviewedBy: "root",
    version: current,
    scenarios: FROZEN_SCENARIO_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      purpose: definition.purpose,
      runner: definition.runner,
      scope: definition.allowedScopes[0],
      manifestPath: path.join(directory, `${definition.id}.json`),
      manifestSha256: "a".repeat(64),
    })),
  };
  plan.scenarios[1].scope = "core-three-cycle";
  const file = path.join(directory, "plan.json");
  const bytes = Buffer.from(JSON.stringify(plan));
  await writeFile(file, bytes);
  const result = run([
    "--plan", "--manifest", file, "--manifest-sha256", digestFrozenEntry(bytes),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FROZEN_ENTRY_SCENARIO_MANIFEST_READ_FAILED/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /desktop:renderer/u);
});
