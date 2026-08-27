import assert from "node:assert/strict";
import test from "node:test";

import { planRunSubmit, planRunSubmitEntry } from "../app/application/run/submit-plan.js";

const readyFacts = {
  sourcePath: "/tmp/a.html",
  context: { epoch: 1 },
};

test("run submit plan fail-closes disposed, unbound, locked and dirty composer states", () => {
  assert.equal(planRunSubmitEntry({ disposed: true }).code, "RUN_WORKFLOW_DISPOSED");
  assert.equal(planRunSubmitEntry().kind, "ready");
  assert.equal(planRunSubmit({}).code, "RUN_SUBMISSION_PROJECT_UNAVAILABLE");
  assert.equal(planRunSubmit({ ...readyFacts, activeLocked: true }).code, "RUN_SUBMISSION_LOCKED");
  assert.equal(planRunSubmit({ ...readyFacts, hasComposerDraft: true }).code, "RUN_SUBMISSION_COMMENT_DRAFT");
  assert.equal(planRunSubmit({ ...readyFacts, hasDirtyEdit: true }).code, "RUN_SUBMISSION_COMMENT_EDIT");
  assert.equal(planRunSubmit(readyFacts).kind, "ready");
});
