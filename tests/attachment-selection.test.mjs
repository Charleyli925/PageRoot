import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_COMMENT_ATTACHMENTS,
  planAttachmentSelection,
} from "../app/lib/attachment-selection.js";

test("empty and oversized attachments are rejected with exact boundaries", () => {
  const validMinimum = { name: "one-byte.txt", size: 1 };
  const validMaximum = { name: "exactly-25mb.zip", size: MAX_ATTACHMENT_BYTES };
  const plan = planAttachmentSelection([
    { name: "empty.txt", size: 0 },
    validMinimum,
    validMaximum,
    { name: "too-large.zip", size: MAX_ATTACHMENT_BYTES + 1 },
  ], 0);

  assert.deepEqual(plan.accepted, [validMinimum, validMaximum]);
  assert.deepEqual(
    plan.invalid.map((file) => file.name),
    ["empty.txt", "too-large.zip"],
  );
  assert.deepEqual(plan.overLimit, []);
});

test("an invalid file does not consume the last available attachment slot", () => {
  const valid = { name: "keep-me.txt", size: 16 };
  const plan = planAttachmentSelection([
    { name: "too-large.zip", size: MAX_ATTACHMENT_BYTES + 1 },
    valid,
  ], MAX_COMMENT_ATTACHMENTS - 1);

  assert.deepEqual(plan.accepted, [valid]);
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.overLimit.length, 0);
});

test("valid overflow is reported separately from invalid files", () => {
  const first = { name: "first.txt", size: 10 };
  const second = { name: "second.txt", size: 10 };
  const plan = planAttachmentSelection([
    { name: "empty.txt", size: 0 },
    first,
    second,
  ], MAX_COMMENT_ATTACHMENTS - 1);

  assert.deepEqual(plan.accepted, [first]);
  assert.deepEqual(plan.overLimit, [second]);
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.available, 1);
});

test("invalid existing counts are safely clamped", () => {
  assert.equal(planAttachmentSelection([{ size: 1 }], -5).accepted.length, 1);
  assert.equal(
    planAttachmentSelection([{ size: 1 }], MAX_COMMENT_ATTACHMENTS + 5).accepted.length,
    0,
  );
  assert.equal(planAttachmentSelection([{ size: 1 }], Number.NaN).accepted.length, 1);
});
