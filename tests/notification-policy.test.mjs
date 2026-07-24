import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("critical notices remain visible until dismissed", () => {
  assert.equal(noticeAutoDismissMs({ tone: "error" }), null);
  assert.equal(noticeAutoDismissMs({ tone: "warning", sticky: true }), null);
  assert.equal(
    noticeAutoDismissMs({
      tone: "info",
      action: { id: "retry", label: "重试" },
    }),
    null,
  );
  assert.equal(noticeAutoDismissMs({ tone: "warning" }), 5_000);
  assert.equal(noticeAutoDismissMs({ tone: "success" }), 2_500);
  assert.equal(noticeAutoDismissMs({ tone: "info" }), 2_500);
});

test("ordinary visible state does not create another toast", () => {
  assert.equal(shouldPresentNotice({ tone: "success", dedupeKey: "qoder-handoff" }), false);
  assert.equal(shouldPresentNotice({ tone: "info", dedupeKey: "current-version-result" }), false);
  assert.equal(shouldPresentNotice({ tone: "warning", dedupeKey: "preview-commit-blocked" }), true);
  assert.equal(shouldPresentNotice({ tone: "warning", dedupeKey: "project-rules-unsaved" }), true);
  assert.equal(shouldPresentNotice({ tone: "error", dedupeKey: "project-open-error" }), true);
  assert.equal(shouldPresentNotice({ tone: "success", action: { id: "open-project" } }), true);
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
    "direct-action",
  );
  assert.equal(
    noticeDisposition({
      tone: "warning",
      sticky: true,
      dedupeKey: "project-rules-unsaved",
    }),
    "user-choice",
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

test("low-priority feedback cannot hide a persistent critical notice", () => {
  assert.equal(
    shouldReplaceNotice(
      { tone: "error", sticky: true, title: "旧问题" },
      {
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
