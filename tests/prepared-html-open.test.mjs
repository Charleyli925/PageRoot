import assert from "node:assert/strict";
import test from "node:test";

import { ProjectFileError } from "../desktop/project-files.mjs";
import {
  assertCommitAction,
  assertExactPayload,
  createPreparedHtmlOpenStore,
  formatProjectsRootLabel,
  publicFactsFromClassification,
  publicPreparedDescriptor,
  resolveOpenDialogDefaultPath,
} from "../desktop/prepared-html-open.mjs";

const SOURCE_SHA = `sha256:${"ab".repeat(32)}`;

test("default projects root uses the product breadcrumb and custom roots stay user-visible", () => {
  assert.equal(
    formatProjectsRootLabel("/Users/demo/Documents/PageRoot/项目", {
      homedir: "/Users/demo",
    }),
    "文稿 › PageRoot › 项目",
  );
  assert.equal(
    formatProjectsRootLabel("/tmp/pageroot-e2e/project-files", {
      homedir: "/Users/demo",
    }),
    "tmp › pageroot-e2e › project-files",
  );
  assert.equal(
    formatProjectsRootLabel("/Users/demo/Work/HTML 项目", {
      homedir: "/Users/demo",
    }),
    "~ › Work › HTML 项目",
  );
});

test("the open dialog always starts from the projects root and never reuses dialog history", async () => {
  const directory = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
  assert.equal(
    await resolveOpenDialogDefaultPath({
      projectsRoot: "/Users/demo/Documents/PageRoot/项目",
      documentsRoot: "/Users/demo/Documents",
      lstat: async () => directory,
    }),
    "/Users/demo/Documents/PageRoot/项目",
  );
  const missingRoot = await resolveOpenDialogDefaultPath({
    projectsRoot: "/Users/demo/Documents/PageRoot/项目",
    documentsRoot: "/Users/demo/Documents",
    lstat: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  assert.equal(missingRoot, "/Users/demo/Documents");
  const symlinkedRoot = await resolveOpenDialogDefaultPath({
    projectsRoot: "/Users/demo/Documents/PageRoot/项目",
    documentsRoot: "/Users/demo/Documents",
    lstat: async () => ({
      isDirectory: () => false,
      isSymbolicLink: () => true,
    }),
  });
  assert.equal(symlinkedRoot, "/Users/demo/Documents");
  assert.equal(await resolveOpenDialogDefaultPath(), null);
});

test("public descriptors never include paths, keys or HTML", () => {
  const known = publicPreparedDescriptor({
    requestId: "req_known",
    classification: "known-external",
    sourcePath: "/Users/demo/产品首页.html",
    classifiedAtSha256: SOURCE_SHA,
    publicFacts: publicFactsFromClassification({
      kind: "known-external",
      projectName: "产品首页",
      currentBasedOnVersionId: "ver_0006",
      currentBasedOnOrdinal: 6,
      latestOfficialVersionId: "ver_0006",
      latestOfficialOrdinal: 6,
      currentDiffersFromBase: true,
      sourceRelation: "unchanged",
    }, { sourceFileName: "产品首页.html" }),
  });
  assert.deepEqual(known, {
    requestId: "req_known",
    classification: "known-external",
    sourceFileName: "产品首页.html",
    projectName: "产品首页",
    currentBasedOnVersionId: "ver_0006",
    currentBasedOnOrdinal: 6,
    latestOfficialVersionId: "ver_0006",
    latestOfficialOrdinal: 6,
    currentDiffersFromBase: true,
    sourceRelation: "unchanged",
  });
  assert.doesNotMatch(JSON.stringify(known), /\/Users|importSourceKey|sha256:/u);

  const fresh = publicPreparedDescriptor({
    requestId: "req_new",
    classification: "new-external",
    sourcePath: "/Users/demo/产品首页.html",
    publicFacts: publicFactsFromClassification({
      kind: "new-external",
      sourceFileName: "产品首页.html",
      visibleV1FileName: "产品首页-V1.html",
    }, { projectsRootLabel: "文稿 › PageRoot › 项目" }),
  });
  assert.equal(fresh.visibleV1FileName, "产品首页-V1.html");
  assert.equal(fresh.projectsRootLabel, "文稿 › PageRoot › 项目");
  assert.doesNotMatch(JSON.stringify(fresh), /\/Users|importSourceKey/u);
});

test("commit actions reject view-initial and mismatched delete requests", () => {
  assert.throws(
    () => assertCommitAction({
      classification: "known-external",
      action: "view-initial",
    }),
    (error) => (
      error instanceof ProjectFileError
      && error.code === "EXTERNAL_OPEN_ACTION_UNSUPPORTED"
    ),
  );
  assert.throws(
    () => assertCommitAction({
      classification: "known-external",
      action: "import-new",
    }),
    /打开之前的项目/u,
  );
  assert.throws(
    () => assertCommitAction({
      classification: "new-external",
      action: "continue-current",
    }),
    /导入并打开/u,
  );
  assert.doesNotThrow(() => assertCommitAction({
    classification: "new-external",
    action: "import-new",
    deleteOriginal: true,
  }));
  assert.throws(
    () => assertCommitAction({
      classification: "known-external",
      action: "continue-current",
      deleteOriginal: true,
    }),
    /删除原文件/u,
  );
});

test("prepared store is idempotent for commit replay and trash is one-shot", () => {
  const store = createPreparedHtmlOpenStore({
    createRequestId: () => "req_intent",
  });
  const descriptor = store.prepare({
    sourcePath: "/tmp/page.html",
    classifiedAtSha256: SOURCE_SHA,
    classification: "new-external",
    publicFacts: {
      sourceFileName: "page.html",
      visibleV1FileName: "page-V1.html",
      projectsRootLabel: "文稿 › PageRoot › 项目",
    },
  });
  assert.equal(descriptor.classification, "new-external");
  assert.equal(store.shouldTrash("req_intent"), false);

  store.beginCommit("req_intent", {
    action: "import-new",
    deleteOriginal: true,
  });
  const receipt = store.completeCommit("req_intent", {
    imported: true,
    managedPath: "/tmp/PageRoot/项目/page/page-V1.html",
    project: { name: "page-V1.html", html: "<html></html>" },
  });
  assert.equal(store.completeCommit("req_intent", { imported: false }), receipt);
  assert.equal(store.shouldTrash("req_intent"), true);
  assert.equal(store.cancel("req_intent"), false);
  assert.equal(store.recordDisposition("req_intent", "trashed"), "trashed");
  assert.equal(store.recordDisposition("req_intent", "trash-failed"), "trashed");
  assert.equal(store.shouldTrash("req_intent"), false);
});

test("cancel before commit forgets user consent and extra payload keys fail closed", () => {
  const store = createPreparedHtmlOpenStore({
    createRequestId: () => "req_cancel",
  });
  store.prepare({
    sourcePath: "/tmp/page.html",
    classifiedAtSha256: SOURCE_SHA,
    classification: "new-external",
    publicFacts: { sourceFileName: "page.html" },
  });
  assert.equal(store.cancel("req_cancel"), true);
  assert.equal(store.peek("req_cancel").state, "canceled");
  assert.throws(
    () => store.beginCommit("req_cancel", { action: "import-new" }),
    /已经失效/u,
  );
  assert.throws(
    () => assertExactPayload(
      { requestId: "req", sourcePath: "/secret.html" },
      ["requestId"],
    ),
    (error) => error.code === "INVALID_PREPARED_OPEN_REQUEST",
  );
});

test("the same source path reuses a prepared or committing intent", () => {
  const store = createPreparedHtmlOpenStore();
  const first = store.prepare({
    requestId: "req_same",
    sourcePath: "/tmp/same.html",
    classifiedAtSha256: SOURCE_SHA,
    classification: "new-external",
  });
  const found = store.findPreparedBySourcePath("/tmp/same.html");
  assert.equal(found?.requestId, first.requestId);
  assert.equal(store.findPreparedBySourcePath("/tmp/other.html"), null);
  store.beginCommit("req_same", { action: "import-new" });
  assert.equal(
    store.findPreparedBySourcePath("/tmp/same.html")?.state,
    "committing",
  );
  store.completeCommit("req_same", { imported: true, project: { sourcePath: "/tmp/v1.html" } });
  assert.equal(store.findPreparedBySourcePath("/tmp/same.html"), null);
});

test("preparing a newer request cancels unanswered older intents", () => {
  const store = createPreparedHtmlOpenStore();
  store.prepare({
    requestId: "req_old",
    sourcePath: "/tmp/old.html",
    classifiedAtSha256: SOURCE_SHA,
    classification: "new-external",
  });
  store.prepare({
    requestId: "req_keep",
    sourcePath: "/tmp/keep.html",
    classifiedAtSha256: SOURCE_SHA,
    classification: "known-external",
  });
  assert.equal(store.cancelOthers("req_keep"), 1);
  assert.equal(store.peek("req_old").state, "canceled");
  assert.equal(store.peek("req_keep").state, "prepared");
});
