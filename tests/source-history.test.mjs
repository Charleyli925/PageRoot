import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  appendSourceHistoryOperations,
  applySourceHistoryAction,
  createEmptySourceHistory,
  normalizeSourceHistory,
  sourceHistoryCapabilities,
  validateSourceHistoryOperationBytes,
} from "../shared/source-history.mjs";

const projectId = "project_history_test";
const documentId = "doc_history_test";
const now = () => "2026-07-31T00:00:00.000Z";
const sha256 = (value) => (
  `sha256:${createHash("sha256").update(value).digest("hex")}`
);

function replacementOperation(before, after, operationId = "sourceop_123456789012") {
  const startOffset = before.indexOf("one");
  return {
    operationId,
    kind: "text",
    editRevision: 1,
    createdAt: now(),
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [{
      startOffset,
      endOffset: startOffset + 3,
      before: "one",
      after: "two",
      kind: "text",
    }],
    reversePatches: [{
      startOffset,
      endOffset: startOffset + 3,
      before: "two",
      after: "one",
      kind: "inverse:text",
    }],
    beforeTarget: { id: "target-a", text: "one" },
    afterTarget: { id: "target-a", text: "two" },
    beforeSelection: { anchor: 0, focus: 3, affinity: "right" },
    afterSelection: { anchor: 3, focus: 3, affinity: "right" },
  };
}

function exactReplacementOperation({
  before,
  after,
  beforeText,
  afterText,
  kind,
  operationId,
  editRevision,
  property,
}) {
  const startOffset = before.indexOf(beforeText);
  assert.notEqual(startOffset, -1);
  assert.equal(
    before.slice(0, startOffset)
      + afterText
      + before.slice(startOffset + beforeText.length),
    after,
  );
  return {
    operationId,
    kind,
    ...(property ? { property } : {}),
    editRevision,
    createdAt: now(),
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [{
      startOffset,
      endOffset: startOffset + beforeText.length,
      before: beforeText,
      after: afterText,
      kind,
    }],
    reversePatches: [{
      startOffset,
      endOffset: startOffset + afterText.length,
      before: afterText,
      after: beforeText,
      kind: `inverse:${kind}`,
    }],
    beforeTarget: { id: `target-${kind}`, state: beforeText },
    afterTarget: { id: `target-${kind}`, state: afterText },
  };
}

test("persistent source history applies exact undo and redo patches", () => {
  const before = "<!doctype html><html><head></head><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const empty = createEmptySourceHistory({
    projectId,
    documentId,
    sourceSha256: sha256(before),
    now,
  });
  const history = appendSourceHistoryOperations(
    empty,
    [replacementOperation(before, after)],
    {
      projectId,
      documentId,
      sourceSha256: sha256(before),
      targetSourceSha256: sha256(after),
      now,
    },
  );
  assert.deepEqual(sourceHistoryCapabilities(history), {
    canUndo: true,
    canRedo: false,
    cursor: 1,
    depth: 1,
    revision: 1,
    sourceSha256: sha256(after),
  });

  const undone = applySourceHistoryAction(history, after, {
    projectId,
    documentId,
    direction: "undo",
    actionId: "sourceaction_123456789012",
    expectedRevision: 1,
    expectedCursor: 1,
    sha256,
    now,
  });
  assert.equal(undone.html, before);
  assert.deepEqual(undone.target, { id: "target-a", text: "one" });
  assert.deepEqual(undone.selection, {
    anchor: 0,
    focus: 3,
    affinity: "right",
  });
  assert.deepEqual(undone.targetTransition, {
    fromTarget: { id: "target-a", text: "two" },
    toTarget: { id: "target-a", text: "one" },
  });
  assert.equal(undone.history.cursor, 0);

  const redone = applySourceHistoryAction(undone.history, before, {
    projectId,
    documentId,
    direction: "redo",
    actionId: "sourceaction_abcdefghijkl",
    expectedRevision: 2,
    expectedCursor: 0,
    sha256,
    now,
  });
  assert.equal(redone.html, after);
  assert.deepEqual(redone.target, { id: "target-a", text: "two" });
  assert.deepEqual(redone.selection, {
    anchor: 3,
    focus: 3,
    affinity: "right",
  });
  assert.deepEqual(redone.targetTransition, {
    fromTarget: { id: "target-a", text: "one" },
    toTarget: { id: "target-a", text: "two" },
  });
  assert.equal(redone.history.cursor, 1);
});

test("persistent source history rejects malformed logical selection metadata", () => {
  const before = "<p>one</p>";
  const after = "<p>two</p>";
  const operation = replacementOperation(before, after);
  operation.beforeSelection = null;
  assert.throws(
    () => appendSourceHistoryOperations(
      createEmptySourceHistory({
        projectId,
        documentId,
        sourceSha256: sha256(before),
        now,
      }),
      [operation],
      {
        projectId,
        documentId,
        sourceSha256: sha256(before),
        targetSourceSha256: sha256(after),
        now,
      },
    ),
    (error) => error.code === "INVALID_SOURCE_HISTORY_SELECTION",
  );
});

test("semantic save evidence uses the patch-scale budget instead of the TargetRef budget", () => {
  const before = "<p>one</p>";
  const after = "<p>two</p>";
  const accepted = replacementOperation(before, after, "sourceop_large_semantic_001");
  accepted.semanticDirection = "forward";
  accepted.semanticOperation = {
    schemaVersion: 1,
    operationId: accepted.operationId,
    type: "insertElement",
    html: "x".repeat(96 * 1024),
  };
  accepted.identityDelta = {
    schemaVersion: 1,
    removedElementIds: Array.from(
      { length: 2_000 },
      (_, index) => `identity-${index}`,
    ),
  };
  const empty = createEmptySourceHistory({
    projectId,
    documentId,
    sourceSha256: sha256(before),
    now,
  });
  const context = {
    projectId,
    documentId,
    sourceSha256: sha256(before),
    targetSourceSha256: sha256(after),
    now,
  };
  assert.doesNotThrow(() => appendSourceHistoryOperations(empty, [accepted], context));

  const oversized = structuredClone(accepted);
  oversized.semanticOperation.html = "x".repeat(8 * 1024 * 1024 + 1);
  assert.throws(
    () => appendSourceHistoryOperations(empty, [oversized], context),
    (error) => error?.code === "SOURCE_HISTORY_SEMANTIC_EVIDENCE_TOO_LARGE",
  );
});

test("text, style, structure, and sibling reorder share one exact durable cursor", () => {
  const sources = [
    "<main><p class=\"plain\">one<br></p><aside>A</aside><section>B</section></main>",
  ];
  sources.push(sources.at(-1).replace("one", "two"));
  sources.push(sources.at(-1).replace('class="plain"', 'class="heavy"'));
  sources.push(sources.at(-1).replace("<br>", "<br><span>new</span>"));
  sources.push(sources.at(-1).replace(
    "<aside>A</aside><section>B</section>",
    "<section>B</section><aside>A</aside>",
  ));
  const changes = [
    {
      kind: "text",
      beforeText: "one",
      afterText: "two",
      property: "editableIslandHtml",
    },
    {
      kind: "style",
      beforeText: 'class="plain"',
      afterText: 'class="heavy"',
      property: "fontWeight",
    },
    {
      kind: "structure",
      beforeText: "<br>",
      afterText: "<br><span>new</span>",
      property: "children",
    },
    {
      kind: "reorder",
      beforeText: "<aside>A</aside><section>B</section>",
      afterText: "<section>B</section><aside>A</aside>",
      property: "siblingIndex",
    },
  ];
  const operations = changes.map((change, index) => (
    exactReplacementOperation({
      ...change,
      before: sources[index],
      after: sources[index + 1],
      editRevision: index + 1,
      operationId: `sourceop_kind_${change.kind}_0001`,
    })
  ));
  let history = appendSourceHistoryOperations(null, operations, {
    projectId,
    documentId,
    sourceSha256: sha256(sources[0]),
    targetSourceSha256: sha256(sources.at(-1)),
    now,
  });
  assert.deepEqual(
    history.entries.map((entry) => entry.kind),
    ["text", "style", "structure", "reorder"],
  );

  let html = sources.at(-1);
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const action = applySourceHistoryAction(history, html, {
      projectId,
      documentId,
      direction: "undo",
      actionId: `sourceaction_kind_undo_${String(index).padStart(2, "0")}`,
      expectedRevision: history.revision,
      expectedCursor: history.cursor,
      sha256,
      now,
    });
    html = action.html;
    history = action.history;
    assert.equal(html, sources[index]);
  }

  for (let index = 0; index < changes.length; index += 1) {
    const action = applySourceHistoryAction(history, html, {
      projectId,
      documentId,
      direction: "redo",
      actionId: `sourceaction_kind_redo_${String(index).padStart(2, "0")}`,
      expectedRevision: history.revision,
      expectedCursor: history.cursor,
      sha256,
      now,
    });
    html = action.html;
    history = action.history;
    assert.equal(html, sources[index + 1]);
  }
});

test("new forward edits truncate redo without crossing an external source boundary", () => {
  const before = "<!doctype html><html><head></head><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const first = appendSourceHistoryOperations(
    null,
    [replacementOperation(before, after)],
    {
      projectId,
      documentId,
      sourceSha256: sha256(before),
      targetSourceSha256: sha256(after),
      now,
    },
  );
  const undone = applySourceHistoryAction(first, after, {
    projectId,
    documentId,
    direction: "undo",
    actionId: "sourceaction_123456789012",
    expectedRevision: 1,
    expectedCursor: 1,
    sha256,
    now,
  });
  const alternate = before.replace("one", "red");
  const next = appendSourceHistoryOperations(
    undone.history,
    [{
      ...replacementOperation(before, alternate, "sourceop_abcdefghijkl"),
      forwardPatches: [{
        startOffset: before.indexOf("one"),
        endOffset: before.indexOf("one") + 3,
        before: "one",
        after: "red",
        kind: "text",
      }],
      reversePatches: [{
        startOffset: before.indexOf("one"),
        endOffset: before.indexOf("one") + 3,
        before: "red",
        after: "one",
        kind: "inverse:text",
      }],
      afterSourceSha256: sha256(alternate),
    }],
    {
      projectId,
      documentId,
      sourceSha256: sha256(before),
      targetSourceSha256: sha256(alternate),
      now,
    },
  );
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].operationId, "sourceop_abcdefghijkl");
  assert.equal(next.appliedActions.length, 0);
  assert.equal(sourceHistoryCapabilities(next).canRedo, false);

  const external = before.replace("one", "outside");
  const reset = appendSourceHistoryOperations(next, [], {
    projectId,
    documentId,
    sourceSha256: sha256(external),
    targetSourceSha256: sha256(external),
    now,
  });
  assert.equal(reset.entries.length, 0);
  assert.equal(reset.baseSourceSha256, sha256(external));
});

test("history refuses stale or tampered exact patches", () => {
  const before = "<!doctype html><html><head></head><body><p>one</p></body></html>";
  const after = before.replace("one", "two");
  const history = appendSourceHistoryOperations(
    null,
    [replacementOperation(before, after)],
    {
      projectId,
      documentId,
      sourceSha256: sha256(before),
      targetSourceSha256: sha256(after),
      now,
    },
  );
  const tampered = structuredClone(history);
  tampered.entries[0].reversePatches[0].after = "evil";
  assert.throws(
    () => applySourceHistoryAction(tampered, after, {
      projectId,
      documentId,
      direction: "undo",
      actionId: "sourceaction_123456789012",
      expectedRevision: 1,
      expectedCursor: 1,
      sha256,
      now,
    }),
    (error) => error.code === "SOURCE_HISTORY_RESULT_MISMATCH",
  );

  const operation = replacementOperation(before, after);
  const replaySteps = validateSourceHistoryOperationBytes(
    [operation],
    before,
    after,
    sha256,
  );
  assert.equal(replaySteps.length, 1);
  assert.equal(replaySteps[0].beforeHtml, before);
  assert.equal(replaySteps[0].afterHtml, after);
  assert.equal(replaySteps[0].operation.operationId, operation.operationId);
  const invalidForward = structuredClone(operation);
  invalidForward.forwardPatches[0].after = "bad";
  assert.throws(
    () => validateSourceHistoryOperationBytes(
      [invalidForward],
      before,
      after,
      sha256,
    ),
    (error) => error.code === "SOURCE_HISTORY_RESULT_MISMATCH",
  );

  const undone = applySourceHistoryAction(history, after, {
    projectId,
    documentId,
    direction: "undo",
    actionId: "sourceaction_reuse_direction_001",
    expectedRevision: 1,
    expectedCursor: 1,
    sha256,
    now,
  });
  assert.throws(
    () => applySourceHistoryAction(undone.history, before, {
      projectId,
      documentId,
      direction: "redo",
      actionId: "sourceaction_reuse_direction_001",
      expectedRevision: 2,
      expectedCursor: 0,
      sha256,
      now,
    }),
    (error) => error.code === "SOURCE_HISTORY_ACTION_REUSED",
  );

  const forgedLedger = structuredClone(undone.history);
  forgedLedger.appliedActions[0].operationId =
    "sourceop_forged_ledger_0001";
  assert.throws(
    () => applySourceHistoryAction(forgedLedger, before, {
      projectId,
      documentId,
      direction: "redo",
      actionId: "sourceaction_after_forged_ledger",
      expectedRevision: 2,
      expectedCursor: 0,
      sha256,
      now,
    }),
    (error) => error.code === "INVALID_SOURCE_HISTORY_ACTION_LEDGER",
  );
});

// A newer PageRoot may add members to the journal. An older build must be able
// to read that journal, keep editing, and write it back without deleting the
// members it does not understand, because a silent field-level overwrite is
// exactly as destructive as losing the whole file.
function journalFromNewerBuild() {
  const before = "<p>one</p>";
  const after = "<p>two</p>";
  const history = appendSourceHistoryOperations(
    createEmptySourceHistory({
      projectId,
      documentId,
      sourceSha256: sha256(before),
      now,
    }),
    [replacementOperation(before, after)],
    {
      projectId,
      documentId,
      sourceSha256: sha256(before),
      targetSourceSha256: sha256(after),
      now,
    },
  );
  const journal = JSON.parse(JSON.stringify(history));
  journal.provenance = { actor: "human", device: "device_future" };
  journal.entries[0].provenance = { seq: 7 };
  journal.entries[0].forwardPatches[0].anchorId = "anchor_future";
  journal.entries[0].beforeSelection.futureAffinity = "sticky";
  return { journal, activeSourceSha256: sha256(after) };
}

test("unknown journal members survive an older build's read and write", () => {
  const { journal, activeSourceSha256 } = journalFromNewerBuild();
  const reread = normalizeSourceHistory(journal, {
    projectId,
    documentId,
    sourceSha256: activeSourceSha256,
    now,
  });

  assert.deepEqual(reread.provenance, {
    actor: "human",
    device: "device_future",
  });
  assert.deepEqual(reread.entries[0].provenance, { seq: 7 });
  assert.equal(reread.entries[0].forwardPatches[0].anchorId, "anchor_future");
  assert.equal(reread.entries[0].beforeSelection.futureAffinity, "sticky");
  assert.deepEqual(reread, journal);
});

test("an unknown member never rescues an invalid required member", () => {
  const { journal, activeSourceSha256 } = journalFromNewerBuild();
  journal.entries[0].forwardPatches[0].startOffset = -1;
  assert.throws(
    () => normalizeSourceHistory(journal, {
      projectId,
      documentId,
      sourceSha256: activeSourceSha256,
      now,
    }),
    (error) => error.code === "INVALID_SOURCE_HISTORY_PATCH",
  );
});
