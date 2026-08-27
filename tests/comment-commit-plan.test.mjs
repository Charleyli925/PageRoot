import assert from "node:assert/strict";
import test from "node:test";

import { planCommentCommit } from "../app/application/comment/commit-plan.js";

test("comment commit plan fail-closes disposed, missing, unsafe, uploading and empty composers", () => {
  assert.equal(planCommentCommit({ disposed: true }).code, "COMMENT_WORKFLOW_DISPOSED");
  assert.equal(planCommentCommit({ target: null }).code, "COMMENT_TARGET_MISSING");
  assert.equal(planCommentCommit({
    target: { resolution: "fuzzy" },
    text: "hello",
  }).code, "COMMENT_TARGET_UNSAFE");
  assert.equal(planCommentCommit({
    target: { resolution: "exact" },
    uploadCount: 1,
    text: "hello",
  }).code, "ATTACHMENT_UPLOAD_PENDING");
  assert.equal(planCommentCommit({
    target: { resolution: "exact" },
    text: "   ",
    attachmentCount: 0,
  }).code, "COMMENT_EMPTY");
  assert.equal(planCommentCommit({
    target: { resolution: "exact" },
    text: "hello",
  }).kind, "ready");
  assert.equal(planCommentCommit({
    target: { resolution: "exact" },
    text: "",
    attachmentCount: 1,
  }).kind, "ready");
});
