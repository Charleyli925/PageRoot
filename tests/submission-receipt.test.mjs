import assert from "node:assert/strict";
import test from "node:test";
import { defaultManagedAgentDelivery } from "../shared/agent-delivery.mjs";
import Ajv2020 from "ajv/dist/2020.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { fixture, importSource } from "./project-file-repository-harness.mjs";
import { ensureCurrentConversation } from "../bridge/conversation-repository.mjs";

const operationId = "submission_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
async function setup(t) {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const input = { expectedSourceSha256: target.sourceSha256, comments: [{ commentId: "comment_test", text: "Adjust heading", target: { targetId: "target_test" }, attachments: [] }], targets: [{ targetId: "target_test" }],
    agentDelivery: { mode: "clipboard" } };
  return { ...value, target, input };
}

test("preflight submission persists before Request authorization and replay keeps one Turn", async (t) => {
  const value = await setup(t);
  const record = await value.repository.recordSubmission({ ...value, operationId });
  assert.equal(record.status, "accepted");
  await assert.rejects(readFile(path.join(value.target.projectRootPath, ".pageroot", "requests", record.requestId, "request.json")), { code: "ENOENT" });
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const replayed = await restarted.recordSubmission({ ...value, operationId });
  assert.equal(replayed.turnId, record.turnId);
  const conversation = await ensureCurrentConversation({ projectRoot: path.join(value.target.projectRootPath, ".pageroot"), projectId: value.target.projectId, documentId: value.target.documentId });
  assert.equal(conversation.turns.length, 1);
  assert.equal(conversation.messages.length, 1);
  const ended = await restarted.finishSubmission({ target: value.target, operationId, status: "not-started", errorCode: "AGENT_AUTH_REQUIRED" });
  assert.equal(ended.status, "not-started");
  const restored = await ensureCurrentConversation({ projectRoot: path.join(value.target.projectRootPath, ".pageroot"), projectId: value.target.projectId, documentId: value.target.documentId });
  assert.equal(restored.turns[0].status, "failed");
  assert.equal(restored.messages.length, 2);
});

test("submission identities cannot be reused for changed delivery or unsafe paths", async (t) => {
  const value = await setup(t);
  await value.repository.recordSubmission({ ...value, operationId });
  await assert.rejects(value.repository.recordSubmission({ ...value, operationId: "../escape" }), { code: "SUBMISSION_ID_INVALID" });
  await assert.rejects(value.repository.recordSubmission({ ...value, operationId, input: { ...value.input, changeEvents: [{ description: "new" }] } }), { code: "SUBMISSION_COLLISION" });
});


test("managed submission records selected service before configuration preflight", async (t) => {
  const value = await setup(t);
  value.input.agentDelivery = defaultManagedAgentDelivery();
  assert.equal(value.input.agentDelivery.configuration, undefined);
  const receipt = await value.repository.recordSubmission({ ...value, operationId });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.snapshot.agentDelivery.selection.providerId, "qoder");
  const schema = JSON.parse(await readFile(new URL("../schemas/submission-receipt.v1.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(receipt), true, JSON.stringify(validate.errors));
});
