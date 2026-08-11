import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { CommentSession } from "../app/application/comment-session.js";
import { DocumentSession } from "../app/application/document-session.js";
import { DraftSession } from "../app/application/draft-session.js";
import { ProjectSession } from "../app/application/project-session.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import { VersionSession } from "../app/application/version-session.js";
import {
  WorkspaceController,
  registrationContextFromOutcome,
} from "../app/application/workspace-controller.js";
import { createEmptySourceHistory } from "../app/domain/source-history.js";

const SOURCE_PATH = "/tmp/workspace-controller.html";
const NEXT_SOURCE_PATH = "/tmp/workspace-controller-next.html";

function sha256(html) {
  return `sha256:${createHash("sha256").update(html).digest("hex")}`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const codecs = {
  isRecord,
  sameSourcePath: (left, right) => Boolean(left && right && left === right),
  draftAuthorityFromWorkspace: (payload) => (
    isRecord(payload.runtimeState) && isRecord(payload.runtimeState.draft)
      ? payload.runtimeState.draft
      : isRecord(payload.activeDraft) ? payload.activeDraft : {}
  ),
  authoritativeDraftRevision: (draft) => Number(draft.draftRevision || 0),
  recoveryIdentityFromRecord: (value) => value || null,
  versionsFromWorkspace: (payload) => Array.isArray(payload.versions)
    ? payload.versions
    : [],
  rebindTargetsPreservingGlobal: (_html, targets) => targets.map((target) => ({
    ...target,
    selector: `${target.selector}[data-rebound]`,
  })),
};

function authoritativeDraft(revision = 0) {
  return {
    draftRevision: revision,
    comments: [],
    changeEvents: [],
    deletedCommentIds: [],
    appliedOperationIds: [],
  };
}

function registrationPayload({
  sourcePath = SOURCE_PATH,
  projectId = "project_registration",
  documentId = "document_registration",
  html = "<main>canonical source</main>",
  draft = authoritativeDraft(4),
} = {}) {
  const sourceSha256 = sha256(html);
  return {
    ok: true,
    projectId,
    documentId,
    sourcePath,
    currentHtmlSha256: sourceSha256,
    content: html,
    project: { displayName: "Canonical project" },
    paths: { projectRecords: "/tmp/PageRoot/project_registration" },
    versions: [{ id: "V1" }],
    runtimeState: { draft },
    sourceHistory: createEmptySourceHistory({
      projectId,
      documentId,
      sourceSha256,
    }),
    recoveryIdentity: { token: "recovery_identity" },
  };
}

function createHarness({
  html = "<main>local source</main>",
  bridgeClient = null,
} = {}) {
  const projectSession = new ProjectSession();
  projectSession.openLocator(SOURCE_PATH);
  const documentSession = new DocumentSession({
    html,
    sourceSha256: sha256(html),
  });
  const client = bridgeClient || {
    async ensureProject() {
      return registrationPayload();
    },
    async workspace() {
      return registrationPayload();
    },
    async saveDraft() {
      return {};
    },
  };
  const commentSession = new CommentSession();
  const draftSession = new DraftSession({ bridgeClient: client });
  const versionSession = new VersionSession();
  const sourceHistorySession = new SourceHistorySession();
  const recovery = [];
  let canvasInvalidations = 0;
  const events = [];
  const controller = new WorkspaceController({
    bridgeClient: client,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    codecs,
    ports: {
      hash: { sha256: async (value) => sha256(value) },
      recovery: { replace: (identity) => recovery.push(identity) },
      canvas: { invalidateRenderAcks: () => { canvasInvalidations += 1; } },
    },
    clock: { now: () => 1_726_000_000_000 },
  });
  controller.subscribeEvents((event) => events.push(event));
  return {
    controller,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    recovery,
    events,
    client,
    get canvasInvalidations() {
      return canvasInvalidations;
    },
  };
}

test("workspace controller registers one injected Session set and publishes canonical authority", async () => {
  const harness = createHarness();
  harness.commentSession.update({
    comments: [{
      commentId: "comment_1",
      target: { id: "target_1", selector: "main" },
    }],
    composerTarget: { id: "target_2", selector: "main > p" },
  });

  const outcome = await harness.controller.ensureRegistered();
  const context = registrationContextFromOutcome(outcome);

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(context, {
    epoch: 1,
    projectId: "project_registration",
    documentId: "document_registration",
    sourcePath: SOURCE_PATH,
  });
  assert.deepEqual(harness.projectSession.context, context);
  assert.equal(harness.documentSession.html, "<main>canonical source</main>");
  assert.equal(harness.documentSession.sourceSha256, sha256("<main>canonical source</main>"));
  assert.equal(harness.versionSession.snapshot.versions[0].id, "V1");
  assert.equal(harness.draftSession.isActive(context), true);
  assert.equal(harness.sourceHistorySession.isActive(context), true);
  assert.equal(harness.commentSession.comments[0].target.selector, "main[data-rebound]");
  assert.equal(
    harness.commentSession.composerTarget.selector,
    "main > p[data-rebound]",
  );
  assert.equal(harness.recovery.length, 1);
  assert.equal(harness.canvasInvalidations, 1);
  assert.deepEqual(harness.events, [{
    type: "registration-published",
    context,
    projectRecordsPath: "/tmp/PageRoot/project_registration",
    projectName: "Canonical project",
    canonicalSourceAdopted: true,
  }]);
});

test("workspace controller shares one registration Promise across durable callers", async () => {
  let resolveEnsure;
  let ensureCount = 0;
  const client = {
    ensureProject() {
      ensureCount += 1;
      return new Promise((resolve) => {
        resolveEnsure = resolve;
      });
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });

  const first = harness.controller.ensureRegistered();
  const second = harness.controller.ensureRegistered();
  assert.equal(first, second);
  assert.equal(ensureCount, 1);
  resolveEnsure(registrationPayload());

  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.status, "succeeded");
  assert.equal(right.status, "succeeded");
  assert.equal(harness.projectSession.context?.projectId, "project_registration");
});

test("a late registration result is stale and cannot publish into the next project", async () => {
  let resolveEnsure;
  const client = {
    ensureProject() {
      return new Promise((resolve) => {
        resolveEnsure = resolve;
      });
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const pending = harness.controller.ensureRegistered();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  resolveEnsure(registrationPayload());

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.sourcePath, NEXT_SOURCE_PATH);
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.documentSession.html, "<main>local source</main>");
  assert.equal(harness.draftSession.context, null);
});

test("a changed expected source Hash retires registration before Session publication", async () => {
  let resolveEnsure;
  const client = {
    ensureProject() {
      return new Promise((resolve) => {
        resolveEnsure = resolve;
      });
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const pending = harness.controller.ensureRegistered();
  const newerHtml = "<main>newer source</main>";
  harness.documentSession.update({
    html: newerHtml,
    sourceSha256: sha256(newerHtml),
  });
  resolveEnsure(registrationPayload());

  const outcome = await pending;
  assert.equal(outcome.status, "stale");
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.documentSession.html, newerHtml);
  assert.equal(harness.draftSession.context, null);
});

test("a source switch retires an in-flight registration instead of blocking the next project", async () => {
  let resolveFirst;
  const calls = [];
  const client = {
    ensureProject({ sourcePath }) {
      calls.push(sourcePath);
      if (calls.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(registrationPayload({
        sourcePath: NEXT_SOURCE_PATH,
        projectId: "project_next",
        documentId: "document_next",
      }));
    },
    async workspace() {
      return {};
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const first = harness.controller.ensureRegistered();
  harness.projectSession.openLocator(NEXT_SOURCE_PATH);
  const second = harness.controller.ensureRegistered({
    sourcePath: NEXT_SOURCE_PATH,
    expectedSourceSha256: harness.documentSession.sourceSha256,
  });

  assert.notEqual(first, second);
  assert.deepEqual(calls, [SOURCE_PATH, NEXT_SOURCE_PATH]);
  assert.equal((await second).status, "succeeded");
  resolveFirst(registrationPayload());
  assert.equal((await first).status, "stale");
  assert.deepEqual(harness.projectSession.context, {
    epoch: 2,
    projectId: "project_next",
    documentId: "document_next",
    sourcePath: NEXT_SOURCE_PATH,
  });
});

test("workspace controller fails closed on a canonical HTML Hash mismatch", async () => {
  const payload = registrationPayload();
  payload.currentHtmlSha256 = sha256("<main>different bytes</main>");
  const harness = createHarness({
    bridgeClient: {
      async ensureProject() {
        return payload;
      },
      async workspace() {
        return {};
      },
      async saveDraft() {
        return {};
      },
    },
  });

  const outcome = await harness.controller.ensureRegistered();
  assert.deepEqual(outcome, {
    status: "rejected",
    code: "PROJECT_REGISTRATION_PAYLOAD_INVALID",
    reason: "项目记录已建立，但返回的身份或源文件校验不完整。",
  });
  assert.equal(harness.projectSession.context, null);
  assert.equal(harness.draftSession.context, null);
});

test("an existing project recovers its Draft authority without creating a second identity", async () => {
  let ensureCount = 0;
  let workspaceCount = 0;
  const client = {
    async ensureProject() {
      ensureCount += 1;
      return registrationPayload();
    },
    async workspace() {
      workspaceCount += 1;
      return registrationPayload({
        draft: authoritativeDraft(12),
      });
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const locator = harness.projectSession.locator;
  const context = harness.projectSession.register({
    ...locator,
    projectId: "project_registration",
    documentId: "document_registration",
  });

  const outcome = await harness.controller.ensureRegistered({
    expectedSourceSha256: harness.documentSession.sourceSha256,
  });
  assert.deepEqual(registrationContextFromOutcome(outcome), context);
  assert.equal(ensureCount, 0);
  assert.equal(workspaceCount, 1);
  assert.deepEqual(harness.projectSession.context, context);
  assert.equal(harness.draftSession.isActive(context), true);
  assert.equal(harness.draftSession.revision, 12);
  assert.deepEqual(harness.events, [{
    type: "draft-authority-rebound",
    context,
  }]);
});

test("a mismatched workspace identity does not rebind a registered Draft", async () => {
  const client = {
    async ensureProject() {
      return registrationPayload();
    },
    async workspace() {
      return registrationPayload({ projectId: "project_wrong" });
    },
    async saveDraft() {
      return {};
    },
  };
  const harness = createHarness({ bridgeClient: client });
  const context = harness.projectSession.register({
    ...harness.projectSession.locator,
    projectId: "project_registration",
    documentId: "document_registration",
  });

  const outcome = await harness.controller.ensureRegistered();
  assert.deepEqual(outcome, {
    status: "rejected",
    code: "PROJECT_REGISTRATION_IDENTITY_MISMATCH",
    reason: "项目记录的身份与当前页面不一致，已停止恢复评论会话。",
  });
  assert.deepEqual(harness.projectSession.context, context);
  assert.equal(harness.draftSession.context, null);
});
