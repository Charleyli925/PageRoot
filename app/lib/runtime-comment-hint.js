export const RUNTIME_VISUAL_HINT_KINDS = Object.freeze([
  "table",
  "table-cell",
  "chart",
  "svg",
  "canvas",
  "runtime-region",
]);

export const RUNTIME_VISUAL_HINT_MAX_LABEL_LENGTH = 160;
export const RUNTIME_VISUAL_HINT_MAX_TEXT_LENGTH = 320;
export const RUNTIME_VISUAL_HINT_MAX_PATH_LENGTH = 400;

const RUNTIME_VISUAL_HINT_KIND_SET = new Set(RUNTIME_VISUAL_HINT_KINDS);

const KIND_LABELS = Object.freeze({
  table: "财务数据表",
  "table-cell": "表格单元格",
  chart: "图表",
  svg: "SVG 图形",
  canvas: "Canvas 图形",
  "runtime-region": "页面内容",
});

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizedBox(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = ["x", "y", "width", "height"];
  const values = keys.map((key) => Number(value[key]));
  if (!values.every((item) => Number.isFinite(item))) return null;
  return Object.fromEntries(keys.map((key, index) => [
    key,
    Math.max(0, Math.min(1, values[index])),
  ]));
}

export function runtimeVisualHintKindLabel(kind) {
  return KIND_LABELS[kind] || KIND_LABELS["runtime-region"];
}

/**
 * Normalizes the small, explanatory runtime visual record that may travel
 * with a comment. It intentionally has no DOM or source-authority behavior.
 */
export function normalizeRuntimeVisualHint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.runtimeGenerated !== true) return null;
  const kind = RUNTIME_VISUAL_HINT_KIND_SET.has(value.kind)
    ? value.kind
    : "runtime-region";
  const label = cleanText(value.label, RUNTIME_VISUAL_HINT_MAX_LABEL_LENGTH)
    || runtimeVisualHintKindLabel(kind);
  const renderedText = cleanText(
    value.renderedText,
    RUNTIME_VISUAL_HINT_MAX_TEXT_LENGTH,
  );
  const relativePath = cleanText(
    value.relativePath,
    RUNTIME_VISUAL_HINT_MAX_PATH_LENGTH,
  );
  const relativeBox = normalizedBox(value.relativeBox);
  return {
    runtimeGenerated: true,
    kind,
    label,
    ...(renderedText ? { renderedText } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(relativeBox ? { relativeBox } : {}),
  };
}

