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

const {
  currentWorkingCopyPresentation,
  folderFromSourcePath,
  projectStatusProjection,
} = await loadProjection();

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

test("project status projection stays silent unless save, AI, or history needs a word", () => {
  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0002",
      latestVersionId: "ver_0006",
      hasLocalModifications: true,
      candidate: { versionId: "ver_0007", status: "ready-to-open" },
    }).facts,
    ["有 AI 修改待查看"],
  );

  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0001",
      currentExactVersionId: "ver_0001",
      latestVersionId: "ver_0001",
    }).facts,
    [],
  );

  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0002",
      latestVersionId: "ver_0006",
      persistState: "writing",
      candidate: { versionId: "ver_0007", status: "processing" },
    }).facts,
    ["正在保存", "正在等 AI"],
  );

  assert.deepEqual(
    projection({
      currentBasedOnVersionId: "ver_0002",
      latestVersionId: "ver_0006",
      persistState: "failed",
      candidate: { versionId: "ver_0007", status: "rejected" },
    }).facts,
    ["保存失败"],
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

  assert.deepEqual(result.facts, ["正在看历史（只读）"]);
  assert.equal(result.label, "正在看历史（只读）");
});

test("current Working Copy presentation follows the live autosave authority", () => {
  assert.deepEqual(
    currentWorkingCopyPresentation({
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: null,
      persistState: "idle",
      persistedDiffersFromBase: false,
      persistedSaveState: "saved",
    }),
    { differsFromBase: true, saveState: "saved" },
  );

  assert.deepEqual(
    currentWorkingCopyPresentation({
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: null,
      persistState: "queued",
      persistedDiffersFromBase: false,
      persistedSaveState: "saved",
    }),
    { differsFromBase: false, saveState: "saving" },
  );

  assert.deepEqual(
    currentWorkingCopyPresentation({
      currentBasedOnVersionId: "ver_0002",
      currentExactVersionId: "ver_0002",
      persistState: "idle",
      persistedDiffersFromBase: true,
      persistedSaveState: "saved",
    }),
    { differsFromBase: false, saveState: "saved" },
  );
});

test("folder labels show only the containing folder name", () => {
  assert.equal(
    folderFromSourcePath("/Users/lizexuan/Documents/PageRoot/项目/26Q2/page-V1.html"),
    "26Q2",
  );
  assert.equal(
    folderFromSourcePath("/Users/lizexuan/Documents/PageRoot/项目/26Q2"),
    "26Q2",
  );
  assert.equal(folderFromSourcePath("C:\\Users\\me\\Reports\\a.html"), "Reports");
  assert.equal(folderFromSourcePath(null), "尚未打开本地文件");
});
