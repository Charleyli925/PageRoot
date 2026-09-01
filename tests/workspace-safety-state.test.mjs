import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveWorkspaceSafetyState,
  workspaceUnavailableFromCode,
} from "../app/lib/workspace-safety-state.js";

test("locator codes map onto the existing workspace-unavailable banner copy", () => {
  assert.equal(workspaceUnavailableFromCode("SOURCE_LOCATOR_REJECTED"), null);
  assert.deepEqual(workspaceUnavailableFromCode("MANAGED_PATH_AMBIGUOUS"), {
    title: "无法确定工作文件",
    message: "检测到多个同等候选文件；修改仍保留，请先恢复唯一文件位置。",
    source: "locator",
  });
  assert.equal(
    workspaceUnavailableFromCode("WORKING_COPY_UNAVAILABLE")?.title,
    "文件暂不可用",
  );
});

test("at most one workspace safety kind is derived, with unavailable first", () => {
  assert.deepEqual(
    deriveWorkspaceSafetyState({
      pendingExit: true,
      persistState: "conflict",
      persistError: "磁盘已变",
      workspaceIssue: { title: "本地项目资料暂时不可用", message: "先导出" },
    }),
    { kind: "workspace-unavailable", reason: "先导出" },
  );
  assert.deepEqual(
    deriveWorkspaceSafetyState({
      persistState: "conflict",
      persistError: "磁盘已变",
    }),
    { kind: "source-conflict", reason: "磁盘已变" },
  );
  assert.equal(
    deriveWorkspaceSafetyState({ persistState: "failed" })?.kind,
    "save-blocked",
  );
  assert.deepEqual(
    deriveWorkspaceSafetyState({ pendingExit: true }),
    { kind: "closing-after-save" },
  );
  assert.equal(deriveWorkspaceSafetyState({ persistState: "idle" }), null);
});
