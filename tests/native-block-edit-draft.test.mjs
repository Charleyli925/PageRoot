import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_BLOCK_COMMAND_REPLACEMENT_POLICY,
  NATIVE_BLOCK_MUTATION_STATES,
  NativeBlockEditDraft,
} from "../app/lib/native-block-edit-draft.js";

const lease = Object.freeze({
  sessionId: "session-1",
  domGeneration: 7,
  sourceRevision: "sha-1",
  hostId: "host-1",
});

const caret = (offset, affinity = "right") => ({
  anchor: offset,
  focus: offset,
  affinity,
});

function createDraft(overrides = {}) {
  return new NativeBlockEditDraft({
    lease,
    baselineText: "hello",
    baselineSelection: caret(5),
    formatSkeleton: {
      wrappers: [{ tag: "strong", start: 0, end: 5 }],
      attributes: { class: "title" },
    },
    ...overrides,
  });
}

test("draft snapshots are deeply immutable and detached from constructor data", () => {
  const skeleton = {
    wrappers: [{ tag: "strong", start: 0, end: 5 }],
  };
  const draft = createDraft({ formatSkeleton: skeleton });
  skeleton.wrappers[0].tag = "em";

  const snapshot = draft.snapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.lease), true);
  assert.equal(Object.isFrozen(snapshot.formatSkeleton.wrappers[0]), true);
  assert.equal(snapshot.formatSkeleton.wrappers[0].tag, "strong");
  assert.throws(() => {
    snapshot.currentSelection.anchor = 0;
  }, TypeError);
  assert.equal(draft.snapshot().currentSelection.anchor, 5);
});

test("draft views expose owned frozen state without deep-copying hot-path data", () => {
  const draft = createDraft({
    formatSkeleton: {
      wrappers: Array.from({ length: 250 }, (_, index) => ({
        tag: index % 2 === 0 ? "strong" : "em",
        start: index,
        end: index + 1,
        metadata: {
          sourceOrder: index,
          attributes: { class: `wrapper-${index}` },
        },
      })),
    },
  });

  const before = draft.view();
  const repeated = draft.view();
  assert.notEqual(before, repeated);
  assert.equal(before.formatSkeleton, repeated.formatSkeleton);
  assert.equal(before.currentSelection, repeated.currentSelection);
  assert.equal(Object.isFrozen(before), true);
  assert.equal(Object.isFrozen(before.formatSkeleton), true);
  assert.equal(Object.isFrozen(before.formatSkeleton.wrappers[0].metadata), true);

  const detached = draft.snapshot();
  assert.notEqual(detached.formatSkeleton, before.formatSkeleton);
  assert.notEqual(detached.currentSelection, before.currentSelection);
  assert.deepEqual(detached, before);

  assert.equal(draft.recordOwnedText({
    lease,
    text: "hello!",
    selection: caret(6),
    evidence: "input",
  }).accepted, true);
  assert.equal(before.currentText, "hello");
  assert.equal(before.currentSelection.anchor, 5);
  assert.equal(draft.view().currentText, "hello!");
});

test("only exact-lease owned input evidence may advance draft text", () => {
  const draft = createDraft();
  const stale = { ...lease, sourceRevision: "sha-stale" };
  assert.deepEqual(
    draft.recordOwnedText({
      lease: stale,
      text: "hello!",
      selection: caret(6),
      evidence: "input",
    }),
    { accepted: false, reason: "stale-lease" },
  );
  assert.equal(draft.snapshot().currentText, "hello");

  assert.equal(draft.recordOwnedText({
    lease,
    text: "hello!",
    selection: caret(6),
    evidence: "observer",
  }).reason, "invalid-owned-evidence");
  assert.equal(draft.snapshot().currentText, "hello");

  assert.equal(draft.recordOwnedText({
    lease,
    text: "hello!",
    selection: caret(6),
    evidence: "input",
  }).accepted, true);
  assert.equal(draft.snapshot().currentText, "hello!");
  assert.equal(
    draft.snapshot().mutationState,
    NATIVE_BLOCK_MUTATION_STATES.DIRTY_OWNED,
  );
});

test("unknown DOM never gains authority and blocks later owned adoption", () => {
  const draft = createDraft();
  assert.equal(draft.recordUnownedMutation({
    lease,
    reason: "extension-inserted-wrapper",
  }).accepted, true);
  assert.equal(draft.snapshot().mutationState, "dirty-unowned");
  assert.equal(draft.snapshot().mutationReason, "extension-inserted-wrapper");

  const result = draft.recordOwnedText({
    lease,
    text: "unknown DOM text",
    selection: caret(3),
    evidence: "input",
  });
  assert.deepEqual(result, { accepted: false, reason: "unowned-dom" });
  assert.equal(draft.snapshot().currentText, "hello");
  assert.equal(draft.snapshot().mutationState, "dirty-unowned");
});

test("poisoned is terminal for DOM evidence but still retains the last trusted text", () => {
  const draft = createDraft();
  draft.recordOwnedText({
    lease,
    text: "hello!",
    selection: caret(6),
    evidence: "input",
  });
  draft.poison({ lease, reason: "mutation-left-edit-island" });

  assert.equal(draft.snapshot().mutationState, "poisoned");
  assert.equal(draft.snapshot().mutationReason, "mutation-left-edit-island");
  assert.equal(draft.recordOwnedText({
    lease,
    text: "attacker text",
    selection: caret(1),
    evidence: "input",
  }).reason, "poisoned");
  assert.equal(draft.snapshot().currentText, "hello!");
});

test("composition ids isolate late tails from a newer composition", () => {
  const draft = createDraft();
  assert.equal(draft.beginComposition({
    lease,
    compositionId: "composition-1",
  }).accepted, true);
  draft.recordOwnedText({
    lease,
    compositionId: "composition-1",
    text: "hello一",
    selection: caret(6),
    evidence: "composition",
  });
  draft.endComposition({ lease, compositionId: "composition-1" });

  assert.equal(draft.beginComposition({
    lease,
    compositionId: "composition-2",
  }).accepted, true);
  const beforeLateTail = draft.snapshot();
  assert.equal(draft.recordOwnedText({
    lease,
    compositionId: "composition-1",
    text: "late tail",
    selection: caret(2),
    evidence: "composition",
  }).reason, "stale-composition");
  assert.deepEqual(draft.snapshot(), beforeLateTail);

  assert.equal(draft.recordOwnedText({
    lease,
    compositionId: "composition-2",
    text: "hello一二",
    selection: caret(7),
    evidence: "composition",
  }).accepted, true);
  assert.equal(draft.snapshot().currentText, "hello一二");
});

test("composition-owned evidence requires the active composition id", () => {
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  assert.equal(draft.recordOwnedText({
    lease,
    text: "hello一",
    selection: caret(6),
    evidence: "composition",
  }).reason, "composition-id-required");
  assert.equal(draft.recordOwnedMutation({
    lease,
    compositionId: "composition-old",
  }).reason, "stale-composition");
  assert.equal(draft.snapshot().currentText, "hello");
});

test("settling requires two identical text and Selection observations in later task turns", () => {
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  draft.endComposition({ lease, compositionId: "composition-1" });

  const first = draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世界",
    selection: caret(7),
    taskTurn: 10,
  });
  assert.deepEqual(first, {
    accepted: true,
    stable: false,
    stableObservationCount: 1,
    advancedTaskTurn: false,
  });
  assert.equal(draft.snapshot().currentText, "hello");
  assert.equal(draft.compositionFallbackCandidate({
    lease,
    compositionId: "composition-1",
  }).reason, "composition-not-stable");

  const sameTurn = draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世界",
    selection: caret(7),
    taskTurn: 10,
  });
  assert.equal(sameTurn.stable, false);
  assert.equal(sameTurn.stableObservationCount, 1);

  const secondTurn = draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世界",
    selection: caret(7),
    taskTurn: 11,
  });
  assert.equal(secondTurn.stable, true);
  assert.equal(secondTurn.stableObservationCount, 2);
  assert.equal(draft.snapshot().currentText, "hello世界");
  assert.deepEqual(
    draft.compositionFallbackCandidate({
      lease,
      compositionId: "composition-1",
    }),
    {
      accepted: true,
      candidate: {
        compositionId: "composition-1",
        text: "hello世界",
        selection: caret(7),
      },
    },
  );
});

test("changed text or Selection restarts settling from one observation", () => {
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  draft.endComposition({ lease, compositionId: "composition-1" });
  draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世",
    selection: caret(6),
    taskTurn: 1,
  });
  const changedText = draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世界",
    selection: caret(7),
    taskTurn: 2,
  });
  assert.equal(changedText.stableObservationCount, 1);

  const changedSelection = draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世界",
    selection: { anchor: 5, focus: 7, affinity: "left" },
    taskTurn: 3,
  });
  assert.equal(changedSelection.stableObservationCount, 1);
  assert.equal(draft.snapshot().currentText, "hello");

  assert.equal(draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "hello世界",
    selection: { anchor: 5, focus: 7, affinity: "left" },
    taskTurn: 4,
  }).stable, true);
});

test("a late owned input after stability revokes fallback until it settles again", () => {
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  draft.endComposition({ lease, compositionId: "composition-1" });
  for (const taskTurn of [1, 2]) {
    draft.observeSettling({
      lease,
      compositionId: "composition-1",
      text: "hello世",
      selection: caret(6),
      taskTurn,
    });
  }
  assert.equal(draft.snapshot().compositionGuard.fallbackAuthorized, true);

  draft.recordOwnedText({
    lease,
    compositionId: "composition-1",
    text: "hello世!",
    selection: caret(7),
    evidence: "input",
  });
  assert.equal(draft.snapshot().compositionGuard.phase, "settling");
  assert.equal(draft.snapshot().compositionGuard.stableObservationCount, 0);
  assert.equal(draft.compositionFallbackCandidate({
    lease,
    compositionId: "composition-1",
  }).reason, "composition-not-stable");
});

for (const unsafeState of ["dirty-unowned", "poisoned"]) {
  test(`${unsafeState} DOM can never expose a stable composition fallback`, () => {
    const draft = createDraft();
    draft.beginComposition({ lease, compositionId: "composition-1" });
    draft.endComposition({ lease, compositionId: "composition-1" });
    for (const taskTurn of [1, 2]) {
      draft.observeSettling({
        lease,
        compositionId: "composition-1",
        text: "hello世",
        selection: caret(6),
        taskTurn,
      });
    }
    assert.equal(draft.snapshot().compositionGuard.fallbackAuthorized, true);

    if (unsafeState === "dirty-unowned") {
      draft.recordUnownedMutation({
        lease,
        reason: "mutation-outside-native-delivery",
      });
    } else {
      draft.poison({ lease, reason: "mutation-left-edit-island" });
    }

    assert.equal(draft.snapshot().mutationState, unsafeState);
    assert.equal(
      draft.snapshot().compositionGuard.fallbackAuthorized,
      false,
    );
    assert.equal(draft.compositionFallbackCandidate({
      lease,
      compositionId: "composition-1",
    }).reason, unsafeState === "dirty-unowned" ? "unowned-dom" : "poisoned");
  });
}

test("timeout never authorizes observed composition text", () => {
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  draft.endComposition({ lease, compositionId: "composition-1" });
  draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "unconfirmed",
    selection: caret(4),
    taskTurn: 1,
  });
  const timeout = draft.markCompositionTimeout({
    lease,
    compositionId: "composition-1",
  });
  assert.deepEqual(timeout, {
    accepted: true,
    phase: "timed-out",
    fallbackAuthorized: false,
  });
  assert.equal(draft.snapshot().currentText, "hello");
  assert.equal(draft.snapshot().compositionGuard.fallbackAuthorized, false);
  assert.equal(draft.compositionFallbackCandidate({
    lease,
    compositionId: "composition-1",
  }).reason, "composition-not-stable");
  assert.equal(draft.observeSettling({
    lease,
    compositionId: "composition-1",
    text: "unconfirmed",
    selection: caret(4),
    taskTurn: 2,
  }).reason, "composition-closed");

  const cancelled = draft.cancelComposition({
    lease,
    compositionId: "composition-1",
  });
  assert.equal(cancelled.accepted, true);
  assert.equal(cancelled.currentText, "hello");
});

test("cancelling only the current composition restores its start text and Selection", () => {
  const draft = createDraft();
  draft.recordOwnedText({
    lease,
    text: "hello stable",
    selection: caret(12),
    evidence: "input",
  });
  draft.beginComposition({ lease, compositionId: "composition-1" });
  draft.recordOwnedText({
    lease,
    compositionId: "composition-1",
    text: "hello stable marked",
    selection: caret(19),
    evidence: "composition",
  });
  const cancelled = draft.cancelComposition({
    lease,
    compositionId: "composition-1",
  });
  assert.equal(cancelled.accepted, true);
  assert.equal(cancelled.currentText, "hello stable");
  assert.deepEqual(cancelled.currentSelection, caret(12));
});

test("a stable provisional composition can be discarded without losing prior strict text", () => {
  const draft = createDraft();
  draft.recordOwnedText({
    lease,
    text: "hello!",
    selection: caret(6),
    evidence: "input",
  });
  draft.beginComposition({
    lease,
    compositionId: "composition-1",
    selection: caret(6),
  });
  draft.endComposition({ lease, compositionId: "composition-1" });
  for (const taskTurn of [1, 2]) {
    draft.observeSettling({
      lease,
      compositionId: "composition-1",
      text: "hello!marked",
      selection: caret(12),
      taskTurn,
    });
  }
  draft.queueCommand({ lease, command: { kind: "save" } });

  const discarded = draft.discardProvisionalComposition({
    lease,
    compositionId: "composition-1",
  });
  assert.deepEqual(discarded, {
    accepted: true,
    phase: "cancelled",
    currentText: "hello!",
    currentSelection: caret(6),
  });
  assert.equal(draft.snapshot().mutationState, "dirty-owned");
  assert.equal(draft.snapshot().compositionGuard.fallbackAuthorized, false);
  assert.equal(draft.snapshot().pendingCommand.kind, "save");
});

test("discarding a clean stable provisional composition restores a clean draft", () => {
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  draft.endComposition({ lease, compositionId: "composition-1" });
  for (const taskTurn of [1, 2]) {
    draft.observeSettling({
      lease,
      compositionId: "composition-1",
      text: "hello marked",
      selection: caret(12),
      taskTurn,
    });
  }

  assert.equal(draft.discardProvisionalComposition({
    lease,
    compositionId: "composition-1",
  }).accepted, true);
  assert.equal(draft.snapshot().currentText, "hello");
  assert.equal(draft.snapshot().mutationState, "clean");
  assert.equal(draft.snapshot().mutationReason, null);
});

test("pending commands use one deterministic latest-wins slot", () => {
  assert.equal(NATIVE_BLOCK_COMMAND_REPLACEMENT_POLICY, "latest-wins");
  const draft = createDraft();
  draft.beginComposition({ lease, compositionId: "composition-1" });
  const savePayload = { path: "/tmp/a.html" };
  const first = draft.queueCommand({
    lease,
    command: { kind: "save", payload: savePayload },
  });
  savePayload.path = "/tmp/mutated.html";
  assert.equal(first.pendingCommand.sequence, 1);
  assert.equal(first.pendingCommand.payload.path, "/tmp/a.html");
  assert.equal(first.pendingCommand.compositionId, "composition-1");

  const second = draft.queueCommand({
    lease,
    command: { kind: "export", payload: { format: "html" } },
  });
  assert.equal(second.policy, "latest-wins");
  assert.equal(second.pendingCommand.sequence, 2);
  assert.equal(second.pendingCommand.kind, "export");
  assert.equal(second.replacedCommand.kind, "save");
  assert.equal(draft.snapshot().pendingCommand.kind, "export");

  const taken = draft.takePendingCommand({ lease });
  assert.equal(taken.command.kind, "export");
  assert.equal(Object.isFrozen(taken.command.payload), true);
  assert.equal(draft.snapshot().pendingCommand, null);
});

test("command authority defaults to user-explicit and rejects unknown values", () => {
  const draft = createDraft();
  const defaultAuthority = draft.queueCommand({
    lease,
    command: { kind: "save" },
  });
  assert.equal(defaultAuthority.accepted, true);
  assert.equal(defaultAuthority.pendingCommand.sequence, 1);
  assert.equal(defaultAuthority.pendingCommand.authority, "user-explicit");

  const invalid = draft.queueCommand({
    lease,
    command: { kind: "refresh", authority: "background-automation" },
  });
  assert.deepEqual(invalid, { accepted: false, reason: "invalid-command" });
  assert.equal(draft.snapshot().pendingCommand.kind, "save");
  assert.equal(draft.snapshot().pendingCommand.sequence, 1);

  const system = draft.queueCommand({
    lease,
    command: { kind: "refresh", authority: "system" },
  });
  assert.equal(system.pendingCommand.sequence, 2);
  assert.equal(system.pendingCommand.authority, "system");
  assert.equal(system.replacedCommand.authority, "user-explicit");
});

test("canonical source rebase is the only recovery from unowned DOM", () => {
  const draft = createDraft();
  draft.queueCommand({ lease, command: { kind: "export" } });
  draft.recordUnownedMutation({ lease });
  const nextLease = { ...lease, sourceRevision: "sha-2" };
  const rebased = draft.rebaseFromSource({
    lease,
    nextLease,
    baselineText: "canonical",
    baselineSelection: caret(9),
    advanceLease: () => true,
  });
  assert.equal(rebased.accepted, true);
  assert.equal(draft.snapshot().mutationState, "clean");
  assert.equal(draft.snapshot().currentText, "canonical");
  assert.equal(draft.snapshot().pendingCommand.kind, "export");

  assert.equal(draft.recordOwnedText({
    lease,
    text: "old event",
    selection: caret(3),
    evidence: "input",
  }).reason, "stale-lease");
  assert.equal(draft.recordOwnedText({
    lease: nextLease,
    text: "canonical!",
    selection: caret(10),
    evidence: "input",
  }).accepted, true);
});

test("source rebase validates fully before its outer lease CAS", () => {
  const draft = createDraft();
  const before = draft.snapshot();
  const nextLease = { ...lease, sourceRevision: "sha-next" };
  let rejectedAdvanceCalls = 0;
  assert.deepEqual(draft.rebaseFromSource({
    lease,
    nextLease,
    baselineText: "next",
    baselineSelection: caret(4),
  }), {
    accepted: false,
    reason: "lease-advance-required",
  });
  assert.deepEqual(draft.snapshot(), before);

  const rejectedAdvance = draft.rebaseFromSource({
    lease,
    nextLease,
    baselineText: "next",
    baselineSelection: caret(4),
    advanceLease: (expected, next) => {
      rejectedAdvanceCalls += 1;
      assert.deepEqual(expected, lease);
      assert.deepEqual(next, nextLease);
      return false;
    },
  });
  assert.deepEqual(rejectedAdvance, {
    accepted: false,
    reason: "lease-advance-rejected",
  });
  assert.equal(rejectedAdvanceCalls, 1);
  assert.deepEqual(draft.snapshot(), before);

  let successfulAdvanceCalls = 0;
  const acceptedRebase = draft.rebaseFromSource({
    lease,
    nextLease,
    baselineText: "next",
    baselineSelection: caret(4),
    advanceLease: () => {
      successfulAdvanceCalls += 1;
      return true;
    },
  });
  assert.equal(acceptedRebase.accepted, true);
  assert.equal(successfulAdvanceCalls, 1);
  assert.deepEqual(draft.snapshot().lease, nextLease);
  assert.equal(draft.snapshot().baselineText, "next");
});

test("expiring a draft rejects late callbacks without changing its last trusted text", () => {
  const draft = createDraft();
  draft.recordOwnedText({
    lease,
    text: "hello!",
    selection: caret(6),
    evidence: "input",
  });
  draft.expire({ lease, reason: "source-authority-fence" });
  const beforeLateEvent = draft.snapshot();
  assert.equal(draft.recordOwnedText({
    lease,
    text: "late tail",
    selection: caret(2),
    evidence: "input",
  }).reason, "expired-lease");
  assert.deepEqual(draft.snapshot(), beforeLateEvent);
  assert.equal(draft.snapshot().currentText, "hello!");
});

test("invalid selections fail closed, including a split surrogate boundary", () => {
  const draft = createDraft({
    baselineText: "A😀B",
    baselineSelection: caret(3),
  });
  const before = draft.snapshot();
  assert.equal(draft.recordOwnedText({
    lease,
    text: "A😀B!",
    selection: caret(2),
    evidence: "input",
  }).reason, "invalid-selection");
  assert.deepEqual(draft.snapshot(), before);

  assert.equal(draft.recordOwnedText({
    lease,
    text: { value: "not text" },
    selection: caret(0),
    evidence: "input",
  }).reason, "invalid-text");
  assert.deepEqual(draft.snapshot(), before);
});

test("composition evidence cannot be adopted outside an identified composition", () => {
  const draft = createDraft();
  assert.equal(draft.recordOwnedText({
    lease,
    text: "hello世",
    selection: caret(6),
    evidence: "composition",
  }).reason, "composition-id-required");
  assert.equal(draft.recordOwnedText({
    lease,
    compositionId: "composition-missing",
    text: "hello世",
    selection: caret(6),
    evidence: "composition",
  }).reason, "stale-composition");
  assert.equal(draft.snapshot().currentText, "hello");
});
