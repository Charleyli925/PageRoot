// Explicit stages for local real-HTML acceptance.  The plan is materialized
// before the runner opens a file so a missing target cannot shrink coverage.
// A = authored text editing, B = element structure, C = Runtime/iframe.

export const REAL_HTML_STAGE_IDS = Object.freeze({
  TEXT_EDITING: "A-text-editing",
  ELEMENT_STRUCTURE: "B-element-structure",
  RUNTIME_IFRAME: "C-runtime-iframe",
});

export const REAL_HTML_OPERATION_IDS = Object.freeze({
  TEXT_ACTIVATE: "activate-text-host",
  TEXT_INPUT_DELETE: "input-delete",
  TEXT_NEWLINE: "newline",
  TEXT_PASTE: "deterministic-paste",
  TEXT_UNDO_REDO: "undo-redo",
  TEXT_FORMAT: "format",
  TEXT_SOURCE_SCOPE: "source-scope",
  STRUCTURE_COPYABLE: "copy-expected-copyable",
  STRUCTURE_NON_COPYABLE: "verify-expected-non-copyable",
  STRUCTURE_DELETE_DUPLICATE: "delete-duplicate",
  RUNTIME_REBUILD: "rebuild-observation",
  RUNTIME_CANDIDATE: "candidate-creation",
  RUNTIME_GENERATION: "generation-switch",
  RUNTIME_DYNAMIC_RECOVERY: "dynamic-runtime-recovery",
  RUNTIME_STATIC_FALLBACK: "static-fallback",
  RUNTIME_REENTER: "source-reload-edit-reentry",
  RUNTIME_VIEWPORT: "viewport-continuity",
  RUNTIME_REOPEN: "managed-project-reopen",
  ORIGINAL_SOURCE_IMMUTABLE: "original-source-immutable",
});

// These selectors are intentionally fixed and test-owned.  The explicit
// marker, rather than an element tag, defines copyability.  The runner takes
// the first document-order match of each selector and never substitutes
// another target after a failed operation.  A real page without the marker
// records that operation as NOT_APPLICABLE with its exact reason.
export const FIXED_STRUCTURE_SAMPLES = Object.freeze({
  expectedCopyable: Object.freeze({
    id: "expected-copyable-paragraph",
    selector: '[data-test-copyability="expected-copyable"][data-pageroot-id]',
    expectedCopyable: true,
    expectedNativeMode: "native-editable",
  }),
  expectedNonCopyable: Object.freeze({
    id: "expected-non-copyable-canvas",
    selector: '[data-test-copyability="expected-non-copyable"][data-pageroot-id]',
    expectedCopyable: false,
    expectedNativeMode: "comment-only",
  }),
});

const STAGE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: REAL_HTML_STAGE_IDS.TEXT_EDITING,
    label: "A 文字编辑",
    category: "text-editing",
    operations: Object.freeze([
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE, label: "激活文字宿主" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_INPUT_DELETE, label: "输入与删除" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_NEWLINE, label: "换行" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_PASTE, label: "确定性粘贴" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_UNDO_REDO, label: "Undo/Redo" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_FORMAT, label: "文字格式" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.TEXT_SOURCE_SCOPE, label: "源码修改范围" }),
    ]),
  }),
  Object.freeze({
    id: REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    label: "B 元素结构",
    category: "element-structure",
    operations: Object.freeze([
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE, label: "expected-copyable 固定样本" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.STRUCTURE_DELETE_DUPLICATE, label: "删除复制元素" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.STRUCTURE_NON_COPYABLE, label: "expected-non-copyable 固定样本" }),
    ]),
  }),
  Object.freeze({
    id: REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
    label: "C Runtime/iframe",
    category: "runtime-iframe",
    operations: Object.freeze([
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD, label: "是否重建" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE, label: "Candidate 创建" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION, label: "generation 切换" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_DYNAMIC_RECOVERY, label: "dynamic runtime 恢复" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_STATIC_FALLBACK, label: "static fallback" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_REENTER, label: "重载后重新编辑" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_VIEWPORT, label: "viewport 连续性" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.RUNTIME_REOPEN, label: "托管项目重开" }),
      Object.freeze({ id: REAL_HTML_OPERATION_IDS.ORIGINAL_SOURCE_IMMUTABLE, label: "原始 HTML 不变" }),
    ]),
  }),
]);

function cloneStage(stage) {
  return {
    id: stage.id,
    label: stage.label,
    metadata: { category: stage.category },
    operations: stage.operations.map((operation) => ({
      id: operation.id,
      label: operation.label,
      metadata: { category: stage.category },
    })),
  };
}

function asFileDescriptor(file, index) {
  const source = typeof file === "string" ? { id: file, label: file } : file;
  if (!source || typeof source !== "object") {
    throw new TypeError(`Real HTML plan file ${index + 1} must be a descriptor.`);
  }
  const id = source.id ?? source.fileId ?? source.name;
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError(`Real HTML plan file ${index + 1} needs an id.`);
  }
  return {
    id,
    label: typeof source.label === "string" && source.label.trim() ? source.label : id,
    applicable: source.applicable !== false,
    reasonCode: source.reasonCode,
    metadata: source.metadata && typeof source.metadata === "object"
      ? { ...source.metadata }
      : {},
    stages: STAGE_DEFINITIONS.map(cloneStage),
  };
}

export function createRealHtmlPlan(files, metadata = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("The real HTML result plan needs at least one file.");
  }
  return {
    id: "real-html-trustworthy-runner",
    label: "Real HTML trustworthy acceptance",
    metadata: {
      lane: "real-html-electron",
      categories: ["A:text-editing", "B:element-structure", "C:runtime-iframe"],
      ...metadata,
    },
    files: files.map(asFileDescriptor),
  };
}
