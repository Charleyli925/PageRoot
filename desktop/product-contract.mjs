export const PRODUCT_MAX_HTML_BYTES = 25 * 1024 * 1024;

// Autosave payloads carry the complete HTML inside JSON. Quotes, backslashes,
// and multi-byte text can make that envelope materially larger than the file.
export const PRODUCT_MAX_BRIDGE_BODY_BYTES = 64 * 1024 * 1024;
export const WORKING_COPY_COMPONENT_MAX_BYTES = 255;

export function productHtmlLimitLabel() {
  return `${PRODUCT_MAX_HTML_BYTES / (1024 * 1024)} MB`;
}

function utf8Truncate(value, maximumBytes) {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character) > maximumBytes) break;
    result += character;
  }
  return result;
}

export function workingCopyStem(value, versionLabel) {
  const suffix = `-${versionLabel}.html`;
  const maximumStemBytes =
    WORKING_COPY_COMPONENT_MAX_BYTES - Buffer.byteLength(suffix);
  const normalized = String(value ?? "")
    .normalize("NFC")
    .replace(/\.html?$/i, "")
    .replace(/-V1\.\d+$/i, "")
    .replace(/[\u0000-\u001f\u007f/\\:]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[ .]+$/, "")
    .trim() || "未命名页面";
  return utf8Truncate(normalized, maximumStemBytes)
    .replace(/[ .]+$/, "")
    .trim() || "未命名页面";
}

export function workingCopyFileName(projectName, versionLabel) {
  if (!/^V1\.\d+$/.test(String(versionLabel ?? ""))) {
    throw new TypeError("Generated working-copy Version label is invalid.");
  }
  return `${workingCopyStem(projectName, versionLabel)}-${versionLabel}.html`;
}

export function isGeneratedWorkingCopyFileName(value) {
  return /^(?:V1\.\d+|[^\u0000-\u001f\u007f/\\]+-V1\.\d+)\.html$/.test(
    String(value ?? ""),
  );
}
