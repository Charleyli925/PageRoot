import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LIFECYCLE_SCHEMA_VERSION,
  projectDirectory,
  recordUserSupplement,
  sealUserSupplementForAttempt,
  validateUserSupplementArchive,
} from "../scripts/lifecycle-core.mjs";

const PROJECT_ID = "project_0123456789abcdef";
const DOCUMENT_ID = "doc_0123456789abcdef";
const REQUEST_ID = "req_0001";
const ATTEMPT_ID = "attempt_001";

async function fixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-supplement-"));
  const projectRoot = projectDirectory(workspaceRoot, PROJECT_ID);
  const requestRoot = path.join(projectRoot, "requests", REQUEST_ID);
  const attemptRoot = path.join(requestRoot, "attempts", ATTEMPT_ID);
  await mkdir(attemptRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "project.json"), JSON.stringify({
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
  }));
  await writeFile(path.join(projectRoot, "runtime-state.json"), JSON.stringify({
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    lifecycleState: "processing",
    activeRun: { requestId: REQUEST_ID, attemptId: ATTEMPT_ID },
  }));
  await writeFile(path.join(requestRoot, "change-request.json"), JSON.stringify({
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    requirements: {
      instructions: [{ instructionId: "instruction_primary" }],
    },
  }));
  return { workspaceRoot, projectRoot, attemptRoot };
}

test("internal AI conversation supplements are append-only, hashed and sealed", async (context) => {
  const current = await fixture();
  context.after(() => rm(current.workspaceRoot, { recursive: true, force: true }));
  const referencePath = path.join(current.workspaceRoot, "参考图片.png");
  await writeFile(referencePath, Buffer.from("managed-reference-image"));

  const added = await recordUserSupplement({
    workspaceRoot: current.workspaceRoot,
    projectId: PROJECT_ID,
    requestId: REQUEST_ID,
    attemptId: ATTEMPT_ID,
    payload: {
      idempotencyKey: "chat-message-001",
      action: "add",
      refersTo: ["instruction_primary"],
      userText: "请参考这张图片，把标题区域再收紧一点。",
      targetDescription: "标题区域",
      attachments: [{ path: referencePath, fileName: "参考图片.png" }],
    },
  });
  assert.equal(added.recordId, "supplement_0001");

  const idempotent = await recordUserSupplement({
    workspaceRoot: current.workspaceRoot,
    projectId: PROJECT_ID,
    requestId: REQUEST_ID,
    attemptId: ATTEMPT_ID,
    payload: {
      idempotencyKey: "chat-message-001",
      action: "add",
      refersTo: ["instruction_primary"],
      userText: "请参考这张图片，把标题区域再收紧一点。",
      targetDescription: "标题区域",
      attachments: [{ path: referencePath, fileName: "参考图片.png" }],
    },
  });
  assert.equal(idempotent.idempotent, true);

  await recordUserSupplement({
    workspaceRoot: current.workspaceRoot,
    projectId: PROJECT_ID,
    requestId: REQUEST_ID,
    attemptId: ATTEMPT_ID,
    payload: {
      idempotencyKey: "chat-message-002",
      action: "amend",
      refersTo: ["supplement_0001"],
      userText: "保留原图比例，但只参考留白关系。",
      targetDescription: "标题区域",
      evidenceState: "text-only",
      attachments: [],
    },
  });

  const sealed = await sealUserSupplementForAttempt({
    attemptRoot: current.attemptRoot,
    expectedIdentity: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      instructionIds: ["instruction_primary"],
    },
  });
  assert.equal(sealed.status, "sealed");
  assert.equal(sealed.recordCount, 2);
  assert.match(sealed.recordsSha256, /^sha256:[a-f0-9]{64}$/);
  assert.match(sealed.attachmentsSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(sealed.records[0].attachments.length, 1);

  const attachment = sealed.records[0].attachments[0];
  assert.deepEqual(
    await readFile(path.join(current.attemptRoot, attachment.relativePath)),
    Buffer.from("managed-reference-image"),
  );
  const verified = await validateUserSupplementArchive({
    attemptRoot: current.attemptRoot,
    expectedIdentity: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      instructionIds: ["instruction_primary"],
    },
    requireSealed: true,
  });
  assert.equal(verified.recordCount, 2);

  await assert.rejects(
    recordUserSupplement({
      workspaceRoot: current.workspaceRoot,
      projectId: PROJECT_ID,
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      payload: {
        idempotencyKey: "chat-message-003",
        action: "add",
        refersTo: [],
        userText: "最终化后再补一句。",
        attachments: [],
      },
    }),
    (error) => error?.code === "USER_SUPPLEMENT_ATTEMPT_CLOSED",
  );
});

test("description-only evidence is explicit when the original file cannot be archived", async (context) => {
  const current = await fixture();
  context.after(() => rm(current.workspaceRoot, { recursive: true, force: true }));
  await recordUserSupplement({
    workspaceRoot: current.workspaceRoot,
    projectId: PROJECT_ID,
    requestId: REQUEST_ID,
    attemptId: ATTEMPT_ID,
    payload: {
      idempotencyKey: "chat-message-description-only",
      action: "add",
      refersTo: [],
      userText: "参考刚才对话里的图片调整配色。",
      evidenceState: "description-only",
      evidenceDescription: "对话中可见一张蓝灰色仪表盘截图，原文件路径不可用。",
      attachments: [],
    },
  });
  const archive = await validateUserSupplementArchive({
    attemptRoot: current.attemptRoot,
    expectedIdentity: {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      requestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      instructionIds: ["instruction_primary"],
    },
  });
  assert.equal(archive.records[0].evidenceState, "description-only");
  assert.equal(archive.records[0].attachments.length, 0);
});
