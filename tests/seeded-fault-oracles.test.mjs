import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DocumentSession } from "../app/application/document-session.js";
import { buildSourceIndex } from "../app/lib/source-patch-core.js";
import { SEEDED_FAULTS } from "../scripts/seeded-fault-oracles.mjs";
import {
  selectGatePlan,
  validateImpactMap,
} from "../scripts/test-gate-core.mjs";

const map = validateImpactMap(JSON.parse(
  await readFile(new URL("./test-impact-map.json", import.meta.url), "utf8"),
));
const ID_A = "pr1_11111111111141118111111111111111";
const ID_B = "pr1_22222222222242228222222222222222";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

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

test("duplicate Stable IDs fail closed in the production source index", () => {
  const unique = buildSourceIndex(
    `<main><p data-pageroot-id="${ID_A}">one</p><p data-pageroot-id="${ID_B}">two</p></main>`,
  );
  assert.equal(unique.pagerootIdentity.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"), false);
  const duplicated = buildSourceIndex(
    `<main><p data-pageroot-id="${ID_A}">one</p><p data-pageroot-id="${ID_A}">two</p></main>`,
  );
  assert.equal(
    duplicated.pagerootIdentity.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"),
    true,
  );
  const restored = buildSourceIndex(
    `<main><p data-pageroot-id="${ID_A}">one</p><p data-pageroot-id="${ID_B}">two</p></main>`,
  );
  assert.equal(restored.pagerootIdentity.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"), false);
});

test("canvas confirmation fails when working HTML was skipped before save", () => {
  const html = "<main>one</main>";
  const digest = sha256(html);
  const session = new DocumentSession({
    html,
    persistedSourceSha256: digest,
  });
  session.reloadCanvas();
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: digest,
  }), true);
  const edited = "<main>two</main>";
  const revision = session.beginEdit(edited);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256(edited),
  }), false);
  assert.equal(session.confirmWorkingHtml({
    revision,
    htmlSha256: sha256(edited),
  }), true);
  assert.equal(session.confirmCanvas({
    generation: 1,
    renderedSha256: sha256(edited),
  }), true);
});
