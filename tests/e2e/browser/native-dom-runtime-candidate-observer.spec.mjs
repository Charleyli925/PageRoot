import { expect, test } from "@playwright/test";

import { REAL_HTML_OPERATION_IDS } from "../electron/real-html/plan.mjs";
import { runtimeOperationOutcomes } from "../electron/real-html/runtime-lifecycle.mjs";
import {
  startRuntimeCandidateObservation,
  stopRuntimeCandidateObservation,
} from "../electron/real-html/runtime-observer.mjs";

const OBSERVER_KEY = "__PAGEROOT_REAL_HTML_RUNTIME_OBSERVER__";

async function startObservation(root) {
  await root.evaluate(startRuntimeCandidateObservation);
}

async function observedRecords(root) {
  return root.evaluate((element, key) => globalThis[key]?.records || [], OBSERVER_KEY);
}

async function stopObservation(root) {
  return root.evaluate(stopRuntimeCandidateObservation);
}

function outcomes(candidateEvidence) {
  return runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence,
  });
}

test("Candidate observer accepts the canonical absent-to-present transition", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.setContent('<main data-runtime-root><iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe></main>');
  const root = page.locator("[data-runtime-root]");
  await startObservation(root);

  await root.evaluate((element) => {
    element.setAttribute("data-runtime-candidate-id", "candidate-2");
  });
  await expect.poll(async () => (await observedRecords(root)).length).toBeGreaterThan(0);
  const records = await stopObservation(root);
  const canonical = records.find((record) => (
    record.evidence === "candidate-id-absent-to-present"
  ));

  expect(canonical).toMatchObject({
    kind: "candidate-created",
    evidence: "candidate-id-absent-to-present",
    candidateId: "candidate-2",
  });
  expect(outcomes(canonical)[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state).toBe("PASS");
});

test("generation change without a Candidate transition is rejected", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({ page }) => {
  await page.setContent('<main data-runtime-root><iframe data-runtime-slot-role="active" data-frame-generation="1"></iframe></main>');
  const root = page.locator("[data-runtime-root]");
  await startObservation(root);

  await root.locator('iframe[data-runtime-slot-role="active"]').evaluate((frame) => {
    frame.setAttribute("data-frame-generation", "2");
  });
  await page.waitForTimeout(0);
  const records = await stopObservation(root);
  const result = outcomes(records.find((record) => (
    record.evidence === "candidate-id-absent-to-present"
  )) || null);

  expect(records).toEqual([]);
  expect(result[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state).toBe("PASS");
  expect(result[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state).toBe("PASS");
  expect(result[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE]).toMatchObject({
    state: "FAIL",
    details: { exactReason: "CANDIDATE_CREATION_NOT_OBSERVED" },
  });
});
