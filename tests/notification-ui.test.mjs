import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workbench, styles, canvas, canvasStyles, notice, noticeStyles] = await Promise.all([
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlCanvasEditor.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/components/NoticeBar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/NoticeBar.module.css", import.meta.url), "utf8"),
]);

test("global notifications expose severity, persistence and actions", () => {
  assert.match(workbench, /noticeAutoDismissMs\(toast\)/);
  assert.match(workbench, /shouldPresentNotice\(next\)/);
  assert.match(workbench, /shouldReplaceNotice\(current, next\)/);
  assert.match(workbench, /<NoticeBar[\s\S]*?className="toast"/);
  assert.match(notice, /data-tone=\{tone\}/);
  assert.match(
    notice,
    /role=\{tone === "error" \? "alert" : "status"\}/,
  );
  assert.match(
    notice,
    /aria-live=\{tone === "error" \? "assertive" : "polite"\}/,
  );
  assert.match(workbench, /action: \{ id: "retry-export"/);
  assert.match(workbench, /title: "副本没有导出"/);
  assert.match(notice, /onMouseEnter=\{\(\) => onPauseChange\?\.\(true\)\}/);
  assert.match(notice, /onFocusCapture=\{\(\) => onPauseChange\?\.\(true\)\}/);
  assert.match(workbench, /setPausedNoticeIdentity\(paused \? noticeIdentity : null\)/);
});

test("redundant feedback was removed and comment persistence is contextual", () => {
  for (const removedCopy of [
    "没有读取到最近项目",
    "关闭已取消，编辑已恢复",
    "内容已更新到文件",
    "已加入本轮要求",
    "没有可撤销的修改",
    "没有可重做的修改",
  ]) {
    assert.doesNotMatch(workbench, new RegExp(removedCopy));
  }
  assert.match(workbench, /className="comment-persist-error[^"]*"/);
  assert.match(workbench, />重试记录<\/button>/);
  assert.match(
    workbench,
    /activeRun\.status === "recovering-transaction"[\s\S]*?role="status"/,
  );
  assert.doesNotMatch(workbench, /title: "直接编辑已阻止"|source-patch-blocked/);
});

test("canvas edit feedback is contextual, plain-language, and not duplicated globally", () => {
  assert.match(canvas, /let title = "请重新选择后再试"/u);
  assert.match(canvas, /title = "这里暂时不能直接改字"/u);
  assert.match(canvas, /title = "已恢复输入前的文字"/u);
  assert.match(canvas, /title = "请重新选择这段文字"/u);
  assert.match(canvas, /这段文字旁有一个空的排版元素/u);
  assert.match(canvas, /直接输入可能跑到错误位置/u);
  assert.match(canvas, /这段内容里有需要保留的网页结构/u);
  assert.match(canvas, /输入法没有完整确认这次输入/u);
  assert.match(canvas, /你仍可以选中文字调整样式，或添加评论交给 AI 处理/u);
  assert.match(canvas, /继续浏览和选择文字/u);
  assert.match(canvas, /sticky: false/u);
  assert.match(canvas, /recovery: "comment"/u);
  assert.match(canvas, /recovery: "reload"/u);
  assert.match(canvas, /<NoticeBar[\s\S]*?placement="canvas"/u);
  assert.match(canvas, /actionLabel=\{editFeedback\.recovery === "reload" \? reloadActionLabel : "添加评论"\}/u);
  assert.match(canvas, /onRequestReload\?\.\(\)/u);
  assert.match(workbench, /if \(sourcePathRef\.current\)[\s\S]*?reloadCurrentSource\(\)[\s\S]*?openProject\(\)/u);
  assert.match(workbench, /reloadActionLabel=\{sourcePath \? "重新载入" : "重新选择"\}/u);
  assert.match(canvas, /editFeedbackPaused/u);
  assert.match(canvas, /\}, 5_000\);/u);
  assert.doesNotMatch(canvas, /本次直接编辑已阻止|"code" in cause/u);
  assert.doesNotMatch(canvas, /这次修改没有应用|原 HTML 没有变化/u);
  assert.doesNotMatch(canvas, /这段内容暂时无法准确定位/u);
  assert.doesNotMatch(workbench, /onEditBlocked=/u);
  assert.doesNotMatch(canvasStyles, /\.editBlockedNotice/u);

  const toolbarControls = canvasStyles.slice(
    canvasStyles.indexOf(".commentToolButton,"),
    canvasStyles.indexOf(".field,", canvasStyles.indexOf(".commentToolButton,")),
  );
  assert.match(toolbarControls, /color: #58535f;[\s\S]*?background: transparent;/u);
  assert.match(
    toolbarControls,
    /\.formatButton\[aria-pressed="true"\][\s\S]*?background: #eceae6;/u,
  );
  assert.doesNotMatch(toolbarControls, /#eeecff|#e4e1ff|#e2dfff/u);
});

test("technical desktop error plumbing is absent from product copy", () => {
  assert.doesNotMatch(
    workbench,
    /Error invoking remote method|ProjectFileError|html-projects:export-copy/,
  );
});

test("critical notices are legible and their close action cannot wrap", () => {
  assert.match(noticeStyles, /\.notice\[data-tone="error"\]/);
  assert.match(noticeStyles, /\.copy strong\s*\{[\s\S]*?font-size:\s*12px/);
  assert.match(noticeStyles, /\.copy > span\s*\{[\s\S]*?font-size:\s*10\.5px/);
  assert.match(
    noticeStyles,
    /\.actions button\s*\{[\s\S]*?min-height:\s*32px/,
  );
  assert.match(noticeStyles, /backdrop-filter:\s*blur\(22px\)/);
  assert.match(
    noticeStyles,
    /left:\s*calc\(\(100vw - var\(--notice-rail-width, 376px\)\) \/ 2\)/,
  );
  assert.doesNotMatch(styles, /\.toast/u);
  assert.match(styles, /\.comment-persist-error\s*\{/);
});

test("file and attachment failures keep a real recovery path", () => {
  assert.match(workbench, /planAttachmentSelection\(files, existingCount\)/);
  assert.doesNotMatch(workbench, /if \(previewAttachments\.length === 0\) return/);
  assert.match(workbench, /if \(selected\.length === 0 && issueNotes\.length > 0\)/);
  assert.match(workbench, /title: addedAttachmentCount > 0[\s\S]*?"附件没有加入"/);
  assert.match(workbench, /dedupeKey: `attachment-batch-\$\{target\.commentId\}`/);
  assert.match(workbench, /id: "open-attachment-picker"[\s\S]*?label: "重新选择"/);
  assert.match(workbench, /id: "review-comment-attachments"[\s\S]*?label: "查看附件"/);
  assert.match(workbench, /请先移除一个附件，再重新选择。/);
  assert.match(
    workbench,
    /action\.id === "review-comment-attachments"[\s\S]*?queueReviewPairReveal[\s\S]*?focusCommentTarget/,
  );
  assert.match(workbench, /title: encodingUnsupported \? "文件编码不支持" : "文件无法打开"/);
  assert.match(workbench, /原文件没有被修改。请先转换为 UTF-8，再重新选择。/);
  assert.match(
    workbench,
    /dedupeKey: "browser-file-error",[\s\S]*?id: "retry-project-open", label: "重新选择"/,
  );
});

test("blocking paths expose an in-context recovery instead of a dead end", () => {
  assert.match(workbench, /const BRIDGE_REQUEST_TIMEOUT_MS = 60_000/);
  assert.match(
    workbench,
    /timeoutMs = BRIDGE_STATE_READ_TIMEOUT_MS/,
  );
  assert.match(workbench, /const reconcilePendingRun = useCallback/);
  assert.match(workbench, /重新核对任务状态/);
  assert.match(workbench, /重新打开源页/);
  assert.match(workbench, /fileView\.error \?/);
  assert.match(workbench, />重试读取</);
  assert.match(workbench, /const finishTargetRelink = useCallback/);
  assert.match(workbench, /重新选择目标/);
  assert.match(workbench, /terminalRun \?/);
  assert.match(workbench, /返回编辑/);
  assert.match(workbench, /调整要求后重试/);
  assert.match(workbench, /className="project-resource-error" role="alert"/);
  assert.match(workbench, /className="recent-projects-error" role="status"/);
});

test("the verified AI file identity appears only after the user opens the ready Version", () => {
  assert.doesNotMatch(workbench, /className="ai-file-opened-card"/);
  assert.doesNotMatch(workbench, /关闭新文件打开提示/);
  assert.match(workbench, /打开最新版/);
  assert.match(workbench, /\/ready-version\/activate/);
  assert.match(
    workbench,
    /<strong[\s\S]*?title=\{activeOpenedAiVersionNotice\?\.fileName \|\| projectName\}[\s\S]*?\{activeOpenedAiVersionNotice\?\.fileName \|\| projectName\}/,
  );
  assert.match(workbench, /setOpenedAiVersionNotice\(\{[\s\S]*?sourcePath: committedSourcePath/);
  assert.doesNotMatch(workbench, /QoderWork 返回的新文件已打开|原文件已保留/);
});

test("ready polling never opens automatically; the adopted marker ends on first edit or comment", () => {
  assert.equal(
    workbench.match(/setOpenedAiVersionNotice\(\{/g)?.length,
    1,
    "only the verified AI-completion path may create the fused state",
  );
  assert.match(
    workbench,
    /await refreshWorkspace\(committedSourcePath, adoptedContext\.epoch\);[\s\S]*?if \(projectLoadErrorRef\.current\)[\s\S]*?setOpenedAiVersionNotice\(\{/,
  );
  const statusFlow = workbench.slice(
    workbench.indexOf("const processRunStatus"),
    workbench.indexOf(
      "\n  useEffect(() => {\n    const poll",
      workbench.indexOf("const processRunStatus"),
    ),
  );
  assert.doesNotMatch(statusFlow, /openCommittedVersion\(/);
  const activationFlow = workbench.slice(
    workbench.indexOf("const activateReadyResult"),
    workbench.indexOf("const waiveCurrentValidation"),
  );
  assert.match(activationFlow, /\/ready-version\/activate/);
  assert.match(activationFlow, /await openCommittedVersion\(run, mergedPayload\)/);
  assert.match(
    workbench,
    /const handleCanvasChange[\s\S]*?setOpenedAiVersionNotice\(null\);/,
  );
  assert.match(
    workbench,
    /const addComment[\s\S]*?setComments\(nextComments\);\s*setOpenedAiVersionNotice\(null\);/,
  );
  assert.match(
    workbench,
    /const applyProject[\s\S]*?setProjectName\(project\.name\);\s*setOpenedAiVersionNotice\(null\);/,
  );
  assert.match(workbench, /className="window-file"/);
  assert.doesNotMatch(workbench, /className="project-switcher"/);
});
