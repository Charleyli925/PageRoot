import assert from "node:assert/strict";
import test from "node:test";

import {
  EditRuntimeCandidateController,
} from "../app/components/edit-runtime-candidate-controller.js";

function begin(controller, generation, sourceRevision = `sha256:${String(generation).padStart(64, "0")}`) {
  return controller.beginCandidate({ generation, sourceRevision }).identity;
}

test("candidate identities are unique and only the latest candidate accepts callbacks", () => {
  const controller = new EditRuntimeCandidateController();
  const first = begin(controller, 4);
  const secondStart = controller.beginCandidate({
    generation: 5,
    sourceRevision: `sha256:${"5".repeat(64)}`,
  });
  const second = secondStart.identity;

  assert.notEqual(first.candidateId, second.candidateId);
  assert.equal(secondStart.supersededCandidate?.candidateId, first.candidateId);
  assert.equal(controller.accepts(first), false);
  assert.equal(controller.accepts(second), true);
  assert.equal(controller.settle(first, "failed").accepted, false);
  assert.equal(controller.snapshot.latestCandidate?.candidateId, second.candidateId);
  assert.equal(controller.snapshot.ignoredCallbackCount, 2);
});

test("last-known-good survives a latest candidate failure", () => {
  const controller = new EditRuntimeCandidateController();
  const first = begin(controller, 1);
  assert.equal(controller.beginPositioning(first), true);
  assert.equal(controller.settle(first, "ready").accepted, true);

  const second = begin(controller, 2);
  const failed = controller.settle(second, "failed");
  assert.deepEqual(failed, {
    accepted: true,
    preserveLastKnownGood: true,
    shouldUseStaticFallback: false,
  });
  assert.equal(controller.snapshot.lastKnownGood?.candidateId, first.candidateId);
});

test("the first real failure requests static fallback", () => {
  const controller = new EditRuntimeCandidateController();
  const first = begin(controller, 1);

  assert.deepEqual(controller.settle(first, "rejected"), {
    accepted: true,
    preserveLastKnownGood: false,
    shouldUseStaticFallback: true,
  });
});

test("user native editing blocks promotion until the transaction ends", () => {
  const controller = new EditRuntimeCandidateController();
  const candidate = begin(controller, 8);

  assert.equal(controller.beginNativeEdit(), true);
  assert.equal(controller.canPromote(candidate), false);
  assert.equal(controller.beginPositioning(candidate), false);
  assert.equal(controller.endNativeEdit(), true);
  assert.equal(controller.beginPositioning(candidate), true);
});

test("only a matching handoff resume can coexist with positioning and finalization", () => {
  const controller = new EditRuntimeCandidateController();
  const candidate = begin(controller, 9);
  const stale = { ...candidate, candidateId: `${candidate.candidateId}-stale` };

  assert.equal(controller.beginPositioning(candidate), true);
  assert.equal(controller.beginNativeEdit(), false);
  assert.equal(controller.beginNativeEdit({ candidate: stale }), false);
  assert.equal(controller.beginNativeEdit({ candidate }), true);
  assert.equal(controller.canFinalize(candidate), true);
  assert.equal(controller.settle(candidate, "ready").accepted, true);
  assert.equal(controller.snapshot.nativeEdit?.kind, "resume");
});

test("supersession is terminal coordination and never requests static fallback", () => {
  const controller = new EditRuntimeCandidateController();
  const first = begin(controller, 1);

  assert.deepEqual(controller.settle(first, "superseded"), {
    accepted: true,
    preserveLastKnownGood: false,
    shouldUseStaticFallback: false,
  });
});
