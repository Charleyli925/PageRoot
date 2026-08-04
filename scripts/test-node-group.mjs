import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const testsRoot = path.join(productRoot, "tests");

const SMOKE_TESTS = new Set([
  "product-contract.test.mjs",
  "scope-validator.test.mjs",
  "source-patch-engine.test.mjs",
]);

const CONTRACT_TESTS = new Set([
  "native-command-queue-contract.test.mjs",
  "notification-ui.test.mjs",
  "workbench-source-fence-contract.test.mjs",
  "workbench-shell-ux.test.mjs",
]);

const PACKAGE_TESTS = new Set([
  "desktop-package.test.mjs",
  "developer-preview-package.test.mjs",
  "package-delivery-report.test.mjs",
  "packaged-artifact-gate.test.mjs",
  "release-candidate-provenance.test.mjs",
  "release-app-stage.test.mjs",
  "release-provenance.test.mjs",
  "source-gate-provenance.test.mjs",
]);

const INTEGRATION_TESTS = new Set([
  "application-update.test.mjs",
  "attachment-storage.test.mjs",
  "bridge-shutdown.test.mjs",
  "desktop-close-recovery.test.mjs",
  "desktop-file-writer.test.mjs",
  "desktop-preload-ipc.test.mjs",
  "export-copy.test.mjs",
  "fixed-targeted-change-fixtures.test.mjs",
  "html-source-parser.test.mjs",
  "lifecycle-core.test.mjs",
  "manual-update.test.mjs",
  "product-contract.test.mjs",
  "qoder-handoff.test.mjs",
  "rendered-html.test.mjs",
  "schema-contract.test.mjs",
  "scope-validator.test.mjs",
  "targeted-change-schema.test.mjs",
  "user-supplement.test.mjs",
  "version-history-records.test.mjs",
  "workspace-bridge.test.mjs",
]);

export async function nodeTestGroups(root = testsRoot) {
  const all = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => entry.name)
    .sort();
  const known = new Set(all);
  for (const [group, names] of [
    ["smoke", SMOKE_TESTS],
    ["contract", CONTRACT_TESTS],
    ["integration", INTEGRATION_TESTS],
    ["package", PACKAGE_TESTS],
  ]) {
    const missing = [...names].filter((name) => !known.has(name));
    if (missing.length > 0) {
      throw new Error(`${group} Node test group references missing files: ${missing.join(", ")}`);
    }
  }
  const reserved = new Set([
    ...CONTRACT_TESTS,
    ...INTEGRATION_TESTS,
    ...PACKAGE_TESTS,
  ]);
  const absolute = (names) => names.map((name) => path.join(root, name));
  return {
    full: absolute(all),
    smoke: absolute(all.filter((name) => SMOKE_TESTS.has(name))),
    core: absolute(all.filter((name) => !reserved.has(name))),
    contract: absolute(all.filter((name) => CONTRACT_TESTS.has(name))),
    integration: absolute(all.filter((name) => INTEGRATION_TESTS.has(name))),
    package: absolute(all.filter((name) => PACKAGE_TESTS.has(name))),
  };
}

async function run() {
  const groupName = process.argv[2] || "full";
  const groups = await nodeTestGroups();
  const files = groups[groupName];
  if (!files) {
    throw new Error(`Unknown Node test group ${JSON.stringify(groupName)}. Expected ${Object.keys(groups).join(", ")}.`);
  }
  if (files.length === 0) throw new Error(`Node test group ${groupName} is empty.`);
  const child = spawn(process.execPath, ["--test", ...files], {
    cwd: productRoot,
    env: process.env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`Node test group ${groupName} ended by ${signal}.`));
      else resolve(exitCode ?? 1);
    });
  });
  process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
