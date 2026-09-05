import assert from "node:assert/strict";
import test from "node:test";

import {
  SEEDED_FAULTS,
  evaluateSeededFault,
} from "../scripts/seeded-fault-oracles.mjs";
import {
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";
import { readFile } from "node:fs/promises";

const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));

test("seeded fault oracles fail closed on the injected product faults", () => {
  for (const fault of SEEDED_FAULTS) {
    const result = evaluateSeededFault(fault.id, fault.snapshot);
    assert.equal(result.passed, false, fault.id);
    assert.ok(result.reason, fault.id);
  }
  assert.equal(
    evaluateSeededFault("active-iframe-cleared", {
      activeIframePresent: true,
      candidateCreated: 0,
    }).passed,
    true,
  );
});

test("seeded faults keep a Draft canary that would kill the corresponding owner", () => {
  for (const fault of SEEDED_FAULTS) {
    const plan = selectGatePlan({
      map,
      lane: "draft",
      changedFiles: [fault.productionFile],
    });
    assert.ok(
      plan.matchedOwners.includes(fault.owner),
      `${fault.id} owner ${fault.owner}`,
    );
    assert.ok(
      plan.suites.some((suite) => suite.id === fault.killer),
      `${fault.id} killer ${fault.killer}`,
    );
  }
});
