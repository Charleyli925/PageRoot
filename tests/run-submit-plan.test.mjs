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

test("legacy Workbench predicates stay equivalent to the RunWorkflow authority plan", () => {
  const legacyPlan = ({
    sourcePath = readyFacts.sourcePath,
    context = readyFacts.context,
    submissionPending = false,
    activeLocked = false,
    composerTarget = null,
    composerDraft = "",
    composerAttachments = [],
    editSession = null,
    editDirty = false,
  } = {}) => {
    if (!sourcePath || !context) return "RUN_SUBMISSION_PROJECT_UNAVAILABLE";
    if (submissionPending || activeLocked) return "RUN_SUBMISSION_LOCKED";
    if (
      composerTarget
      && (composerDraft.trim() || composerAttachments.length > 0)
    ) return "RUN_SUBMISSION_COMMENT_DRAFT";
    if (editSession && editDirty) return "RUN_SUBMISSION_COMMENT_EDIT";
    return "ready";
  };
  const authorityPlan = (facts) => {
    const plan = planRunSubmit({
      sourcePath: facts.sourcePath,
      context: facts.context,
      submissionPending: facts.submissionPending,
      activeLocked: facts.activeLocked,
      hasComposerDraft: Boolean(
        facts.composerTarget
        && (facts.composerDraft.trim() || facts.composerAttachments.length > 0)
      ),
      hasDirtyEdit: Boolean(facts.editSession && facts.editDirty),
    });
    return plan.kind === "ready" ? "ready" : plan.code;
  };
  const base = {
    sourcePath: readyFacts.sourcePath,
    context: readyFacts.context,
    submissionPending: false,
    activeLocked: false,
    composerTarget: null,
    composerDraft: "",
    composerAttachments: [],
    editSession: null,
    editDirty: false,
  };
  const cases = {
    clean: {},
    "draft text": { composerTarget: {}, composerDraft: "draft" },
    "draft attachment": { composerTarget: {}, composerAttachments: [{}] },
    "clean edit": { editSession: {}, editDirty: false },
    "dirty edit": { editSession: {}, editDirty: true },
    locked: { activeLocked: true },
    "missing context": { context: null },
  };
  for (const [name, override] of Object.entries(cases)) {
    const facts = { ...base, ...override };
    assert.equal(authorityPlan(facts), legacyPlan(facts), name);
  }
});
