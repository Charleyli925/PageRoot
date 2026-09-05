import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SEEDED_FAULTS } from "../scripts/seeded-fault-oracles.mjs";
import { assertTestInventory } from "../scripts/generate-test-inventory.mjs";
import { validateImpactMap } from "../scripts/test-gate-core.mjs";

const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));
const ledger = JSON.parse(
  await readFile(new URL("./test-risk-ledger.json", import.meta.url), "utf8"),
);
const ownerIds = new Set(map.rules.map((rule) => rule.id));
const seededFaultIds = new Set(SEEDED_FAULTS.map((fault) => fault.id));

test("Playwright inventory stays aligned with the repository and E2E README", async () => {
  const inventory = await assertTestInventory();
  assert.ok(inventory.specFiles.includes("tests/e2e/electron/electron-runtime-continuity.spec.mjs"));
  assert.ok(inventory.specFiles.includes("tests/e2e/electron/electron-runtime-scripts.spec.mjs"));
  assert.ok(inventory.specFiles.includes("tests/e2e/electron/ai-review-versions.spec.mjs"));
  assert.equal(
    inventory.specFiles.includes("tests/e2e/browser/native-dom-editing.spec.mjs"),
    false,
  );
});

test("every Playwright spec has a risk ledger owner, oracle and stage", () => {
  assert.equal(ledger.version, 1);
  for (const [file, entry] of Object.entries(ledger.files)) {
    assert.ok(entry.riskId, file);
    assert.ok(ownerIds.has(entry.primaryOwner), `${file} owner ${entry.primaryOwner}`);
    assert.ok(entry.oracle, file);
    assert.match(String(entry.stage), /^(?:edit|draft-canary|ready-full|release)$/u, file);
    if (entry.seededFault) {
      assert.ok(seededFaultIds.has(entry.seededFault), `${file} seededFault ${entry.seededFault}`);
    }
  }
});

test("risk ledger covers every Playwright spec file and no retired paths", async () => {
  const inventory = await assertTestInventory();
  const missing = inventory.specFiles.filter((file) => !ledger.files[file]);
  assert.deepEqual(missing, []);
  const extra = Object.keys(ledger.files).filter((file) => !inventory.specFiles.includes(file));
  assert.deepEqual(extra, []);
});
