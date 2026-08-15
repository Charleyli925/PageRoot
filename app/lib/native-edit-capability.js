const DEDICATED_EDITOR_ROOTS = new Set([
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "script",
  "style",
  "template",
  "title",
  "canvas",
  "audio",
  "video",
  "object",
  "embed",
  "iframe",
  "svg",
  "math",
  "pre",
  "code",
]);

// SourcePatch still uses this predicate to decide whether a tag can host a
// native text island. These roots are document/collection boundaries, void
// elements, or surfaces whose value/content needs a dedicated editor. Entry
// gating lives in HtmlCanvasEditor; this helper must stay byte-stable until
// a later fail-open change explicitly widens it.
const NON_TEXT_ISLAND_ROOTS = new Set([
  ...DEDICATED_EDITOR_ROOTS,
  "html",
  "head",
  "body",
  "base",
  "link",
  "meta",
  "area",
  "br",
  "col",
  "hr",
  "img",
  "param",
  "source",
  "track",
  "wbr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup",
  "ul",
  "ol",
  "menu",
  "dl",
  "form",
  "fieldset",
  "datalist",
  "details",
]);

function isNativeTextIslandCandidateRoot(tagName) {
  const normalized = String(tagName ?? "").toLowerCase();
  return Boolean(normalized) && !NON_TEXT_ISLAND_ROOTS.has(normalized);
}

export function isNativeDirectEditRoot(tagName) {
  return isNativeTextIslandCandidateRoot(tagName);
}
