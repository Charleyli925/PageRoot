import assert from "node:assert/strict";
import test from "node:test";

import {
  isSavableCommentTarget,
  planCommentCommit,
} from "../app/application/comment/commit-plan.js";

const ELEMENT_ID = "pr1_11111111111141118111111111111111";

test("comment commit plan fail-closes disposed, missing, unsafe, uploading and empty composers", () => {
  assert.equal(planCommentCommit({ disposed: true }).code, "COMMENT_WORKFLOW_DISPOSED");
  assert.equal(planCommentCommit({ target: null }).code, "COMMENT_TARGET_MISSING");
  assert.equal(planCommentCommit({
    target: { resolution: "fuzzy" },
    text: "hello",
  }).code, "COMMENT_TARGET_UNSAFE");
  assert.equal(planCommentCommit({
    target: { resolution: "exact" },
    text: "hello",
  }).code, "COMMENT_TARGET_UNSAFE");
  assert.equal(planCommentCommit({
    target: { resolution: "exact", elementId: ELEMENT_ID },
    uploadCount: 1,
    text: "hello",
  }).code, "ATTACHMENT_UPLOAD_PENDING");
  assert.equal(planCommentCommit({
    target: { resolution: "exact", elementId: ELEMENT_ID },
    text: "   ",
    attachmentCount: 0,
  }).code, "COMMENT_EMPTY");
  assert.equal(planCommentCommit({
    target: { resolution: "exact", elementId: ELEMENT_ID },
    text: "hello",
  }).kind, "ready");
  assert.equal(planCommentCommit({
    target: { resolution: "exact", elementId: ELEMENT_ID },
    text: "",
    attachmentCount: 1,
  }).kind, "ready");
  assert.equal(planCommentCommit({
    target: { resolution: "exact", selector: "body", level: "module" },
    text: "global",
  }).kind, "ready");
  assert.equal(isSavableCommentTarget({
    resolution: "exact",
    elementId: ELEMENT_ID,
  }), true);
  assert.equal(isSavableCommentTarget({
    resolution: "exact",
    elementId: "pr1_invalid",
  }), false);
});
