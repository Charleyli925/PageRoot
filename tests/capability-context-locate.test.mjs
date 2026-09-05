import assert from "node:assert/strict";
import test from "node:test";

import { compareLocateTasks, locateSummary } from "../scripts/capability-context-locate.mjs";

test("five representative tasks locate owners before any diff exists", () => {
  const summary = locateSummary();
  assert.equal(summary.taskCount, 5);
  assert.equal(summary.locatedAfter, 5);
  assert.equal(summary.locatedBefore, 3);
  assert.equal(summary.ownerHits, 5);
  assert.equal(summary.completeMatrixSelections, 0);
  assert.ok(summary.afterFirstLocateBytes < summary.legacyDisclosureBytes);

  const byId = Object.fromEntries(summary.rows.map((row) => [row.id, row]));
  assert.equal(byId["semantic-editing"].beforeLocated, false);
  assert.equal(byId["semantic-editing"].afterLocated, true);
  assert.equal(byId["runtime-continuity"].beforeLocated, false);
  assert.equal(byId["runtime-continuity"].afterLocated, true);
  assert.equal(byId["comments-layout"].beforeLocated, true);
  assert.ok(byId["comments-layout"].afterFirstLocateBytes < byId["comments-layout"].beforeFirstLocateBytes);
  assert.equal(byId["comments-layout"].includesStateOwnership, false);
  assert.equal(byId["comments-layout"].includesSecurityModel, false);
  assert.equal(byId["runtime-continuity"].includesHtmlCanvasEditor, true);
  assert.ok(byId["runtime-continuity"].afterContractBytes < 20 * 1024);
  assert.equal(byId["runtime-continuity"].includesProjectFileRepository, false);
  for (const row of summary.rows) {
    assert.equal(row.probeMapped, true);
    assert.equal(row.ownerHit, true);
    assert.equal(row.contractHit, true);
    assert.equal(row.gate.selectsCompleteMatrix, false);
  }
});

test("cold-start domain query and probe-file query agree on the representative tasks", () => {
  const rows = compareLocateTasks();
  for (const row of rows) {
    assert.ok(row.afterDomains.includes(row.domainIds[0]));
    assert.ok(row.probeMapped);
  }
});
