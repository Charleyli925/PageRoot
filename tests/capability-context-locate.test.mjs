import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertCapabilityContextMap,
  loadCapabilityContextMap,
} from "../scripts/capability-context.mjs";
import {
  BEFORE_MAP_FIXTURE,
  compareLocateTasks,
  locateSummary,
  uniquePresetLocateBytes,
} from "../scripts/capability-context-locate.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("preset first-locate bytes do not count a contract file again as a document", () => {
  const duplicated = uniquePresetLocateBytes({
    contractFiles: ["docs/ARCHITECTURE_MAP.md"],
    requiredDocs: {
      files: ["docs/ARCHITECTURE_MAP.md", "AGENTS.md"],
      sections: [{ path: "docs/ARCHITECTURE_MAP.md", headings: ["## Current edit contract"] }],
    },
    wholeFileBytes: (file) => (file === "docs/ARCHITECTURE_MAP.md" ? 1000 : 100),
    sectionBytes: () => 50,
  });
  assert.equal(duplicated.firstLocateBytes, 1100);
  assert.equal(duplicated.uniqueDocBytes, 100);
});

test("historical locate baseline does not require current files to exist", () => {
  const beforeMap = loadCapabilityContextMap(BEFORE_MAP_FIXTURE, { validatePaths: false });
  const stale = structuredClone(beforeMap);
  stale.domains[0].entryInterfaces = [
    ...stale.domains[0].entryInterfaces,
    "retired/does-not-exist.js",
  ];
  const rows = compareLocateTasks({ beforeMap: stale });
  assert.equal(rows.length, 5);

  const current = structuredClone(loadCapabilityContextMap());
  current.domains[0].entryInterfaces = ["retired/does-not-exist.js"];
  assert.throws(
    () => assertCapabilityContextMap(current, productRoot),
    /missing files/,
  );
});
