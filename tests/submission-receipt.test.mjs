import assert from "node:assert/strict";
import test from "node:test";
import { defaultManagedAgentDelivery } from "../shared/agent-delivery.mjs";
import Ajv2020 from "ajv/dist/2020.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { fixture, importSource, html as fixtureHtml } from "./project-file-repository-harness.mjs";
import { ensureCurrentConversation, readConversation, writeConversation } from "../bridge/conversation-repository.mjs";

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

async function prepareRecordedRequest(value) {
  const receipt = await value.repository.recordSubmission({ ...value, operationId });
  await value.repository.prepareRequest({ target: value.target, requestId: receipt.requestId,
    expectedSourceSha256: value.input.expectedSourceSha256,
    request: { ...value.input, submissionOperationId: operationId }, prompt: "Synthetic frozen request" });
  await value.repository.finishSubmission({ target: value.target, operationId, status: "request-created" });
  return receipt;
}

test("new Bridge owner recovers unstarted submission without granting Request authority", async (t) => {
  const value = await setup(t);
  const receipt = await value.repository.recordSubmission({ ...value, operationId });
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  const recovered = await restarted.submissionReceipt({ target: value.target, operationId });
  assert.equal(recovered.status, "not-started");
  assert.equal(recovered.errorCode, "SUBMISSION_INTERRUPTED_BEFORE_REQUEST");
  await assert.rejects(readFile(path.join(value.target.projectRootPath, ".pageroot", "requests", receipt.requestId, "request.json")), { code: "ENOENT" });
});

test("execution facts replay exactly once and restart preserves uncertain Request authority", async (t) => {
  const value = await setup(t);
  const receipt = await prepareRecordedRequest(value);
  const event = { eventId: "event_distinct_start_1", kind: "started", timestamp: new Date().toISOString() };
  await value.repository.recordExecutionFact({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId, event });
  await value.repository.recordExecutionFact({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId, event });
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  await restarted.initialize();
  const recovered = await restarted.submissionReceipt({ target: value.target, operationId });
  assert.equal(recovered.events.filter((fact) => fact.kind === "started").length, 1);
  assert.equal(recovered.events.filter((fact) => fact.kind === "interrupted").length, 1);
  const record = JSON.parse(await readFile(path.join(value.target.projectRootPath, ".pageroot", "requests", receipt.requestId, "request.json"), "utf8"));
  assert.equal(record.status, "processing");
  const conversation = await ensureCurrentConversation({ projectRoot: path.join(value.target.projectRootPath, ".pageroot"), projectId: value.target.projectId, documentId: value.target.documentId });
  assert.equal(conversation.turns.length, 1);
  assert.equal(conversation.turns[0].status, "interrupted");
  assert.equal(conversation.messages.filter((message) => message.text === "已开始执行本轮修改。").length, 1);
});

test("durable no-change outcome ends the Turn and remains stable after restart", async (t) => {
  const value = await setup(t);
  const receipt = await prepareRecordedRequest(value);
  const html = await readFile(value.target.exactSourcePath, "utf8");
  const ended = await value.repository.completeRequest({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId, html });
  assert.equal(ended.status, "no-change");
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  const conversation = await ensureCurrentConversation({ projectRoot: path.join(value.target.projectRootPath, ".pageroot"), projectId: value.target.projectId, documentId: value.target.documentId });
  assert.equal(conversation.turns[0].status, "completed");
  assert.equal(conversation.messages.filter((message) => message.text.startsWith("本轮没有产生修改")).length, 1);
  await restarted.recordSubmission({ ...value, operationId: "submission_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
});


test("crash after authoritative outcome write replays history without repeating execution", async (t) => {
  const value = await setup(t);
  const receipt = await prepareRecordedRequest(value);
  const crashing = new ProjectFileRepository({ projectsRoot: value.projects,
    failpoint(name) { if (name === "request-history-pending") throw new Error("synthetic crash before projection"); } });
  await assert.rejects(crashing.completeRequest({ target: value.target, requestId: receipt.requestId,
    attemptId: receipt.attemptId, html: await readFile(value.target.exactSourcePath, "utf8") }), /synthetic crash/);
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  await restarted.initialize();
  const conversation = await ensureCurrentConversation({ projectRoot: path.join(value.target.projectRootPath, ".pageroot"), projectId: value.target.projectId, documentId: value.target.documentId });
  assert.equal(conversation.turns[0].status, "completed");
  assert.equal(conversation.messages.filter((message) => message.text.startsWith("本轮没有产生修改")).length, 1);
});


test("accepted stop fences late output while confirmed cancellation remains separate", async (t) => {
  const value = await setup(t);
  const receipt = await prepareRecordedRequest(value);
  await value.repository.recordExecutionFact({ target: value.target, requestId: receipt.requestId,
    attemptId: receipt.attemptId, event: { eventId: "event_stop_1", kind: "stop-requested", timestamp: new Date().toISOString() } });
  await assert.rejects(value.repository.completeRequest({ target: value.target, requestId: receipt.requestId,
    attemptId: receipt.attemptId, html: await readFile(value.target.exactSourcePath, "utf8") }), { code: "AGENT_STOP_PENDING" });
  const record = JSON.parse(await readFile(path.join(value.target.projectRootPath, ".pageroot", "requests", receipt.requestId, "request.json"), "utf8"));
  assert.equal(record.status, "processing");
  const cancelled = await value.repository.cancelRequest({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId });
  assert.equal(cancelled.status, "cancelled");
});

test("a candidate that won before stop is retained until an explicit discard", async (t) => {
  const value = await setup(t);
  const receipt = await prepareRecordedRequest(value);
  const html = (await readFile(value.target.exactSourcePath, "utf8")).replaceAll(">V1<", ">V2<");
  const ready = await value.repository.completeRequest({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId, html });
  assert.equal(ready.status, "candidate-ready");
  const stopped = await value.repository.cancelRequest({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId });
  assert.equal(stopped.status, "result-ready");
  assert.equal(stopped.candidateId, ready.candidate.candidateId);
  const discarded = await value.repository.cancelRequest({ target: value.target, requestId: receipt.requestId, attemptId: receipt.attemptId, discardCandidate: true });
  assert.equal(discarded.status, "cancelled");
});
for (const boundary of ["messages", "contexts", "bytes"]) {
  test(`submission reserves terminal capacity near conversation ${boundary} limit`, async (t) => {
    const { appendConversationContext, startConversationTurn, sealConversationTurn } = await import("../shared/conversation.mjs");
    const value = await setup(t);
    const context = { projectRoot: path.join(value.target.projectRootPath, ".pageroot"),
      projectId: value.target.projectId, documentId: value.target.documentId };
    const now = () => "2026-09-08T00:00:00.000Z";
    let old = await ensureCurrentConversation(context);
    for (let i = 0; i < (boundary === "contexts" ? 199 : 1); i++) {
      old = appendConversationContext(old, { contextId: `context_history_${String(i).padStart(12, "0")}`,
        sourceSha256: value.target.sourceSha256, side: "working-copy" }, { now });
    }
    old = startConversationTurn(old, { turnId: "turn_history_000000000001", contextId: old.activeContextId,
      mode: "discussion", status: "running" }, { now });
    const messageCount = boundary === "messages" ? 499 : boundary === "bytes" ? 62 : 1;
    old = sealConversationTurn(old, { turnId: "turn_history_000000000001", status: "completed",
      messages: Array.from({ length: messageCount }, (_, i) => ({
        messageId: `message_history_${String(i).padStart(12, "0")}`, actor: "user", kind: "text",
        status: "completed", text: boundary === "bytes" ? "x".repeat(120000) : `old requirement ${i}`,
      })) }, { now });
    await writeConversation(context, old);
    const receipt = await prepareRecordedRequest(value);
    assert.notEqual(receipt.conversationId, old.conversationId);
    const current = await ensureCurrentConversation(context);
    assert.equal(current.supersedesConversationId, old.conversationId);
    const candidate = await value.repository.completeRequest({ target: value.target,
      requestId: receipt.requestId, attemptId: receipt.attemptId, html: fixtureHtml("V2") });
    assert.equal(candidate.status, "candidate-ready");
    const adopted = await value.repository.promoteCandidate({ target: value.target,
      candidateId: candidate.candidate.candidateId });
    assert.equal(adopted.promoted, true);
    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    await restarted.initialize();
    const archived = await readConversation(context, old.conversationId);
    assert.equal(archived.status, "archived");
    assert.deepEqual(archived.messages, old.messages);
    const restored = await ensureCurrentConversation(context);
    assert.equal(restored.conversationId, receipt.conversationId);
    assert.equal(restored.turns[0].status, "completed");
    await restarted.recordSubmission({ target: adopted.target,
      operationId: "submission_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      input: { ...value.input, expectedSourceSha256: adopted.target.sourceSha256 } });
  });
}
