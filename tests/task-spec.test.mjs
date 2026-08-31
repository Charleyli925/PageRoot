import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  TASK_SCOPE_TARGETS_ONLY,
  TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES,
  TASK_SCOPE_WHOLE_PAGE,
  TASK_SPEC_SCHEMA_VERSION,
  assertTaskSpec,
  compileTaskSpec,
} from "../shared/task-spec.mjs";

const ELEMENT_ID = "pr1_11111111111141118111111111111111";
const SOURCE_SHA = `sha256:${"1".repeat(64)}`;

function target(overrides = {}) {
  return {
    targetId: "target_title",
    elementId: ELEMENT_ID,
    expectedSourceSha256: SOURCE_SHA,
    label: "首屏标题",
    level: "module",
    selector: "h1",
    fingerprint: {
      tagName: "h1",
      stableAttributes: {},
      ancestorFingerprint: [],
    },
    resolution: "exact",
    ...overrides,
  };
}

function comment(text, targetValue = target(), attachments = []) {
  return {
    commentId: "comment_title",
    text,
    target: targetValue,
    attachments,
  };
}

test("Task Spec compiles exact comments without adding requirements", () => {
  const text = "强化主按钮层级。确保移动端不溢出；本轮不需要修改导航栏。";
  const spec = compileTaskSpec({
    comments: [comment(text)],
    targets: [target()],
  });

  assert.equal(spec.taskSchemaVersion, TASK_SPEC_SCHEMA_VERSION);
  assert.equal(spec.objective, text);
  assert.equal(spec.scopePolicy, TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES);
  assert.deepEqual(spec.instructions, [{
    instructionId: "instruction_title",
    priority: "required",
    text,
    targetRefs: ["target_title"],
    acceptanceCriteria: ["确保移动端不溢出"],
  }]);
  assert.deepEqual(spec.globalAcceptanceCriteria, []);
  assert.deepEqual(spec.nonGoals, ["本轮不需要修改导航栏"]);
  assert.deepEqual(spec.attachments, []);
});

test("Task Spec derives whole-page and strict-source scopes conservatively", () => {
  const pageTarget = target({
    targetId: "target_page",
    elementId: undefined,
    expectedSourceSha256: undefined,
    label: "整个页面",
    selector: "body",
    fingerprint: undefined,
  });
  const wholePage = compileTaskSpec({
    comments: [{
      commentId: "comment_page",
      text: "统一整页的视觉层级。",
      target: pageTarget,
      attachments: [],
    }],
    targets: [pageTarget],
  });
  assert.equal(wholePage.scopePolicy, TASK_SCOPE_WHOLE_PAGE);

  const targetsOnly = compileTaskSpec({
    comments: [comment("不得修改评论目标之外的源码。")],
    targets: [target()],
  });
  assert.equal(targetsOnly.scopePolicy, TASK_SCOPE_TARGETS_ONLY);
});

test("Task Spec keeps attachment references unresolved until Request bytes freeze", () => {
  const draftAttachment = { attachmentId: "attachment_reference" };
  const pending = compileTaskSpec({
    comments: [comment("参考附件调整标题。", target(), [draftAttachment])],
    targets: [target()],
  });
  assert.deepEqual(pending.instructions[0].attachmentRefs, ["attachment_reference"]);
  assert.throws(
    () => assertTaskSpec(pending),
    (error) => error?.code === "TASK_SPEC_INVALID",
  );
  assert.doesNotThrow(
    () => assertTaskSpec(pending, { requireAttachmentResolution: false }),
  );
});

test("Task Spec v1 JSON Schema accepts the generated strict contract", async () => {
  const [taskSchema, changeRequestSchema] = await Promise.all([
    readFile(new URL("../schemas/task-spec.v1.schema.json", import.meta.url), "utf8"),
    readFile(new URL("../schemas/change-request.v3.schema.json", import.meta.url), "utf8"),
  ]).then((values) => values.map(JSON.parse));
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  ajv.addSchema(changeRequestSchema);
  const validate = ajv.compile(taskSchema);
  const spec = compileTaskSpec({
    comments: [comment("把标题改成欢迎页。")],
    targets: [target()],
  });
  assert.equal(validate(spec), true, ajv.errorsText(validate.errors));
});
