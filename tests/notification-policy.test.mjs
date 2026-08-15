import assert from "node:assert/strict";
import test from "node:test";

import {
  createNoticeDismissalMemory,
  nextPresentedNotice,
  noticeAutoDismissMs,
  noticeDisposition,
  productErrorMessage,
  shouldPresentNotice,
  shouldReplaceNotice,
} from "../app/lib/notification-policy.js";

test("technical Electron IPC prefixes never reach the visible error copy", () => {
  const message = productErrorMessage(
    new Error(
      "Error invoking remote method 'html-projects:export-copy': "
      + "ProjectFileError: 导出副本不能覆盖当前源 HTML，请选择另一个位置。",
    ),
    "导出没有完成。",
  );
  assert.equal(
    message,
    "导出副本不能覆盖当前源 HTML，请选择另一个位置。",
  );
  assert.doesNotMatch(message, /Error invoking|html-projects|ProjectFileError/);
});

test("only explicit decisions persist while background results expire", () => {
  assert.equal(noticeAutoDismissMs({ tone: "error" }), null);
  assert.equal(noticeAutoDismissMs({ tone: "warning", sticky: true }), null);
  assert.equal(
    noticeAutoDismissMs({
      tone: "info",
      action: { id: "retry", label: "重试" },
    }),
    3_500,
  );
  assert.equal(
    noticeAutoDismissMs({
      disposition: "direct-action",
      tone: "info",
      action: { id: "choose", label: "选择新位置" },
    }),
    null,
  );
  assert.equal(
    noticeAutoDismissMs({
      disposition: "background-result",
      tone: "warning",
    }),
    8_000,
  );
  assert.equal(noticeAutoDismissMs({ tone: "warning" }), 6_000);
  assert.equal(noticeAutoDismissMs({ tone: "success" }), 3_500);
  assert.equal(noticeAutoDismissMs({ tone: "info" }), 3_500);
});

test("sticky conflict notices remain present even without an explicit disposition", () => {
  assert.equal(
    shouldPresentNotice({
      sticky: true,
      tone: "warning",
      dedupeKey: "source-conflict",
    }),
    true,
  );
});

test("ordinary visible state does not create another toast", () => {
  assert.equal(shouldPresentNotice({ tone: "success", dedupeKey: "qoder-handoff" }), false);
  assert.equal(shouldPresentNotice({ tone: "info", dedupeKey: "current-version-result" }), false);
  assert.equal(shouldPresentNotice({ tone: "warning", dedupeKey: "preview-commit-blocked" }), false);
  assert.equal(shouldPresentNotice({ tone: "warning", dedupeKey: "project-rules-unsaved" }), false);
  assert.equal(shouldPresentNotice({ tone: "error", dedupeKey: "project-open-error" }), false);
  assert.equal(shouldPresentNotice({ tone: "success", action: { id: "open-project" } }), false);
  assert.equal(shouldPresentNotice({
    disposition: "background-result",
    tone: "success",
    action: { id: "open-project" },
  }), true);
});

test("recovery ownership is decided before presentation", () => {
  assert.equal(
    noticeDisposition({ disposition: "silent-recover", tone: "warning" }),
    "silent-recover",
  );
  assert.equal(
    noticeDisposition({ disposition: "defer-and-resume", tone: "info" }),
    "defer-and-resume",
  );
  assert.equal(
    noticeDisposition({ tone: "warning", action: { id: "retry" } }),
    "inform-in-place",
  );
  assert.equal(
    noticeDisposition({
      tone: "warning",
      sticky: true,
      dedupeKey: "project-rules-unsaved",
    }),
    "inform-in-place",
  );
  assert.equal(
    shouldPresentNotice({
      disposition: "silent-recover",
      tone: "warning",
      sticky: true,
    }),
    false,
  );
  assert.equal(
    shouldPresentNotice({
      disposition: "defer-and-resume",
      tone: "info",
    }),
    false,
  );
  assert.equal(
    shouldPresentNotice({
      disposition: "direct-action",
      tone: "warning",
      action: { id: "retry" },
    }),
    true,
  );
  assert.equal(
    shouldPresentNotice({
      disposition: "user-choice",
      tone: "warning",
      sticky: true,
    }),
    true,
  );
  assert.equal(
    shouldPresentNotice({
      disposition: "background-result",
      tone: "warning",
    }),
    true,
  );
  assert.equal(
    shouldPresentNotice({
      disposition: "inform-in-place",
      tone: "success",
    }),
    false,
  );
});

test("disposition matrix keeps timeout and user-action ownership explicit", () => {
  const cases = [
    {
      name: "silent recovery stays in its owning surface",
      notice: { disposition: "silent-recover", tone: "warning" },
      present: false,
      timeout: 6_000,
    },
    {
      name: "deferred recovery stays in its owning surface",
      notice: { disposition: "defer-and-resume", tone: "info" },
      present: false,
      timeout: 3_500,
    },
    {
      name: "direct action waits for the user",
      notice: {
        disposition: "direct-action",
        tone: "warning",
        action: { id: "retry", label: "重新选择" },
      },
      present: true,
      timeout: null,
    },
    {
      name: "user choice waits for the user",
      notice: {
        disposition: "user-choice",
        tone: "info",
        action: { id: "choose", label: "选择位置" },
      },
      present: true,
      timeout: null,
    },
    {
      name: "background results are transient",
      notice: { disposition: "background-result", tone: "success" },
      present: true,
      timeout: 8_000,
    },
    {
      name: "in-place feedback remains with its caller",
      notice: {
        disposition: "inform-in-place",
        tone: "warning",
        action: { id: "ignored", label: "不应显示" },
      },
      present: false,
      timeout: 6_000,
    },
  ];

  for (const { name, notice, present, timeout } of cases) {
    assert.equal(shouldPresentNotice(notice), present, name);
    assert.equal(noticeAutoDismissMs(notice), timeout, name);
  }
});

test("low-priority feedback cannot hide a persistent critical notice", () => {
  assert.equal(
    shouldReplaceNotice(
      { tone: "error", sticky: true, title: "旧问题" },
      {
        disposition: "direct-action",
        tone: "warning",
        sticky: true,
        title: "当前操作需要决定",
        action: { id: "retry", label: "重试" },
      },
    ),
    true,
  );
  assert.equal(
    shouldReplaceNotice(
      { tone: "error", sticky: true, title: "副本没有导出" },
      { tone: "success", title: "评论已添加" },
    ),
    false,
  );
  assert.equal(
    shouldReplaceNotice(
      {
        tone: "error",
        sticky: true,
        dedupeKey: "export",
        title: "副本没有导出",
        message: "磁盘不可写",
      },
      {
        disposition: "background-result",
        tone: "success",
        dedupeKey: "export",
        title: "副本已导出",
        message: "已写入新位置",
      },
    ),
    true,
  );
});

test("a scoped notice can change severity without changing its copy", () => {
  assert.equal(
    shouldReplaceNotice(
      {
        tone: "warning",
        dedupeKey: "background-project",
        title: "项目需要处理",
        message: "打开项目查看详情。",
      },
      {
        tone: "error",
        sticky: true,
        dedupeKey: "background-project",
        title: "项目需要处理",
        message: "打开项目查看详情。",
      },
    ),
    true,
  );
});

test("internal state vocabulary is translated before display", () => {
  assert.equal(
    productErrorMessage(
      "runtime-state revision Hash 核对失败。",
      "项目状态核对失败。",
    ),
    "项目运行状态 编辑状态 内容校验 核对失败。",
  );
});

test("network timeouts use the product-safe contextual fallback", () => {
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  assert.equal(
    productErrorMessage(
      timeout,
      "项目状态读取超时，请重试；源文件没有被改动。",
    ),
    "项目状态读取超时，请重试；源文件没有被改动。",
  );
});

test("structured project identity errors use one safe product message", () => {
  const error = new Error(
    "projectId does not match sourcePath /Users/example/private-report.html",
  );
  error.code = "PROJECT_ID_MISMATCH";
  assert.equal(
    productErrorMessage(error, "项目操作没有完成。"),
    "项目身份暂时无法核对。当前内容仍保留，请重新打开源页后再试。",
  );
});

test("candidate assessment failures use accurate localized project copy", () => {
  const error = new Error(
    "candidate-assessment.json is structurally invalid.",
  );
  error.code = "CANDIDATE_ASSESSMENT_INVALID";
  assert.equal(
    productErrorMessage(error, "项目状态暂时无法读取。"),
    "某次 AI 结果的校验记录无法核对。当前 HTML 没有被改动，请重试读取。",
  );
});

test("unknown internal fields and local paths never reach product copy", () => {
  assert.equal(
    productErrorMessage(
      new Error(
        "documentId doc_secret does not match sourcePath /Users/example/report.html",
      ),
      "项目操作没有完成。",
    ),
    "项目操作没有完成。",
  );
  assert.equal(
    productErrorMessage(
      new Error("Unexpected lifecycle invariant violation"),
      "项目操作没有完成。",
    ),
    "项目操作没有完成。",
  );
});

test("notice dismissal memory merges repeats inside one second and prunes stale keys", () => {
  let now = 1_000;
  const memory = createNoticeDismissalMemory({ now: () => now });
  const first = {
    title: "保存失败",
    message: "请重试",
    tone: "error",
    disposition: "background-result",
    dedupeKey: "source-reload",
  };
  memory.rememberDismissal(first);
  now = 1_400;
  const repeated = memory.withRepeatCount(first);
  assert.equal(repeated.repeatCount, 2);
  now = 8_000;
  memory.rememberDismissal({ ...first, dedupeKey: "unique-old" });
  now = 14_000;
  assert.equal(memory.withRepeatCount(first).repeatCount, undefined);
});

test("nextPresentedNotice stays a pure replacement choice", () => {
  const current = {
    title: "旧提示",
    message: "仍在",
    tone: "error",
    sticky: true,
    disposition: "user-choice",
    dedupeKey: "keep",
  };
  const ignored = {
    title: "已保存",
    message: "完成",
    tone: "success",
    dedupeKey: "saved",
  };
  assert.equal(nextPresentedNotice(current, ignored), current);
  const next = {
    title: "项目已解锁",
    message: "可以继续编辑",
    tone: "success",
    disposition: "background-result",
    dedupeKey: "source-force-unlock",
  };
  assert.equal(nextPresentedNotice(null, next), next);
});
