import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadModel() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/project-version-tree-model.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "project-version-tree-model.ts",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`,
  );
}

const {
  fallbackVersionFileName,
  formatSidebarVersionDateTime,
  formatSidebarVersionTime,
  projectVersionSummariesFromVersions,
  versionInheritanceDescription,
} = await loadModel();

function localDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

test("sidebar timestamps use local today, same-year, and cross-year forms", () => {
  const now = localDate(2026, 8, 28, 14, 32);
  assert.equal(
    formatSidebarVersionTime(localDate(2026, 8, 28, 14, 32).toISOString(), now),
    "14:32",
  );
  assert.equal(
    formatSidebarVersionTime(localDate(2026, 8, 27, 9, 5).toISOString(), now),
    "8/27",
  );
  assert.equal(
    formatSidebarVersionTime(localDate(2025, 12, 31, 9, 5).toISOString(), now),
    "2025/12/31",
  );
  assert.equal(
    formatSidebarVersionDateTime(localDate(2026, 8, 28, 14, 32).toISOString()),
    "2026年8月28日 14:32",
  );
});

test("summary projection keeps real filenames and gives old records a deterministic fallback", () => {
  const versions = projectVersionSummariesFromVersions([
    {
      id: "ver_0001",
      ordinal: 1,
      label: "版本 1",
      summary: "",
      generatedAt: "2026-08-01T08:00:00.000Z",
      source: "初始页面",
      requirement: null,
      contentSha256: "",
      previousVersionId: null,
      basedOnVersionId: null,
      requestId: null,
      attemptId: null,
      committed: true,
      comments: [],
      directEdits: [],
      supplements: [],
      validationReview: null,
      candidateAssessment: null,
      workingCopyId: "work_ver_0001",
      displayFileName: "真实名称-V1.html",
      modifiedAt: "2026-08-01T08:00:00.000Z",
    },
    {
      id: "ver_0002",
      ordinal: 2,
      label: "版本 2",
      summary: "",
      generatedAt: "2026-08-02T08:00:00.000Z",
      source: "内部 AI",
      requirement: null,
      contentSha256: "",
      previousVersionId: "ver_0001",
      basedOnVersionId: "ver_0001",
      requestId: null,
      attemptId: null,
      committed: true,
      comments: [],
      directEdits: [],
      supplements: [],
      validationReview: null,
      candidateAssessment: null,
      workingCopyId: "work_ver_0002",
    },
  ], "project_0123456789abcdef", "doc_0123456789abcdef", "真实名称-V2.html", {
    activeVersionId: "ver_0002",
    activeModifiedAt: "2026-08-03T09:10:00.000Z",
  });
  assert.equal(versions[0].displayFileName, "真实名称-V1.html");
  assert.equal(versions[1].displayFileName, "真实名称-V2.html");
  assert.equal(versions[1].modifiedAt, "2026-08-03T09:10:00.000Z");
  assert.equal(fallbackVersionFileName("真实名称-V2.html", 7), "真实名称-V7.html");
});

test("inheritance copy identifies sequential, branch, initial, and active files", () => {
  const parent = {
    projectId: "project_0123456789abcdef",
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0002",
    ordinal: 2,
    basedOnVersionId: "ver_0001",
    previousVersionId: "ver_0001",
    displayFileName: "项目-V2.html",
    modifiedAt: "2026-08-02T08:00:00.000Z",
    isActiveWorkingCopy: false,
    isLatestOfficial: true,
  };
  assert.equal(
    versionInheritanceDescription({ ...parent, versionId: "ver_0003", ordinal: 3, basedOnVersionId: "ver_0002", previousVersionId: "ver_0002", displayFileName: "项目-V3.html" }, parent),
    "基于 项目-V2.html 修改生成",
  );
  assert.equal(
    versionInheritanceDescription({ ...parent, versionId: "ver_0004", ordinal: 4, basedOnVersionId: "ver_0002", previousVersionId: "ver_0003", displayFileName: "项目-V4.html" }, parent),
    "基于 项目-V2.html 修改生成 · 独立分支",
  );
  assert.equal(
    versionInheritanceDescription({ ...parent, versionId: "ver_0001", ordinal: 1, basedOnVersionId: null, previousVersionId: null, displayFileName: "项目-V1.html" }, null),
    "项目初始导入版本",
  );
  assert.equal(
    versionInheritanceDescription({ ...parent, isActiveWorkingCopy: true }, parent),
    "基于 项目-V2.html 修改生成 · 当前编辑文件",
  );
});
