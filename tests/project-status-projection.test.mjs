import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadProjection() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/project-model.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "project-model.ts",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`,
  );
}

const { projectStatusProjection } = await loadProjection();

function projection(input) {
  return projectStatusProjection({
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    latestVersionId: null,
    viewMode: "current",
    viewingVersionId: null,
    persistState: "idle",
    hasLocalModifications: false,
    candidate: null,
    ...input,
  });
}

test("project status projection preserves independent Version, save and Candidate facts", () => {
  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0002",
      latestVersionId: "ver_0006",
      hasLocalModifications: true,
      candidate: { versionId: "ver_0007", status: "ready-to-open" },
    }).facts,
    ["基于 V2", "项目最新 V6", "本地修改已保存", "候选 V7 待审阅"],
  );

  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0001",
      currentExactVersionId: "ver_0001",
      latestVersionId: "ver_0001",
    }).facts,
    ["基于 V1", "项目最新 V1", "当前与 V1 一致"],
  );

  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0002",
      latestVersionId: "ver_0006",
      persistState: "writing",
      candidate: { versionId: "ver_0007", status: "processing" },
    }).facts,
    ["基于 V2", "项目最新 V6", "本地修改正在保存", "候选 V7 生成中"],
  );

  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0002",
      latestVersionId: "ver_0006",
      persistState: "failed",
      candidate: { versionId: "ver_0007", status: "rejected" },
    }).facts,
    ["基于 V2", "项目最新 V6", "本地修改保存失败", "候选 V7 已拒绝"],
  );
});

test("history projection never changes the current editing basis", () => {
  const result = projection({
    currentBasedOnVersionId: "ver_0002",
    currentExactVersionId: null,
    latestVersionId: "ver_0006",
    viewMode: "history",
    viewingVersionId: "ver_0002",
  });

  assert.deepEqual(result.facts, ["正在查看 V2", "只读浏览"]);
  assert.equal(result.label, "正在查看 V2 · 只读浏览");
});
