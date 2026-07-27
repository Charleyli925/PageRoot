import { parseFragment, serialize, serializeOuter } from "parse5";

import { resolveTargetRef } from "./target-resolver.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const ROOT_BLOCKED_TAGS = new Set([
  "html",
  "head",
  "body",
  "base",
  "link",
  "meta",
  "script",
  "style",
  "template",
  "iframe",
  "object",
  "embed",
  "canvas",
  "svg",
  "math",
  "audio",
  "video",
  "form",
  "input",
  "textarea",
  "select",
  "option",
  "optgroup",
]);

const INLINE_CONTENT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "button",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "ruby",
  "rp",
  "rt",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

const IMMUTABLE_ATOM_TAGS = new Set(["img"]);
const IMMUTABLE_EMBED_TAGS = new Set([
  "audio",
  "canvas",
  "embed",
  "iframe",
  "input",
  "math",
  "object",
  "select",
  "svg",
  "textarea",
  "video",
]);
const RUNTIME_ATTRIBUTE_NAMES = new Set([
  "contenteditable",
  "data-html-ai-source-node-id",
  "data-html-canvas-editing",
  "data-html-canvas-selected",
  "data-html-canvas-global-selected",
  "data-pageroot-v2-editing",
  "role",
  "spellcheck",
]);
const RUNTIME_ATTRIBUTE_PREFIXES = [
  "data-pageroot-",
  "data-html-canvas-",
];
const PROTECTED_ATTRIBUTE_NAMES = new Set([
  "action",
  "formaction",
  "for",
  "href",
  "id",
  "name",
  "src",
  "srcset",
  "type",
  "value",
]);

export class EditableIslandError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EditableIslandError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new EditableIslandError(code, message, details);
}

function childNodesFor(node) {
  if (node?.nodeName === "template" && node.content) return node.content.childNodes ?? [];
  return node?.childNodes ?? [];
}

function isRuntimeAttribute(name) {
  const normalized = String(name ?? "").toLowerCase();
  return RUNTIME_ATTRIBUTE_NAMES.has(normalized)
    || RUNTIME_ATTRIBUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isProtectedAttribute(name) {
  const normalized = String(name ?? "").toLowerCase();
  return PROTECTED_ATTRIBUTE_NAMES.has(normalized)
    || normalized.startsWith("on")
    || normalized.startsWith("data-")
    || normalized.startsWith("aria-");
}

function isImmutableAtomNode(node, tagName, attributes) {
  if (IMMUTABLE_ATOM_TAGS.has(tagName)) return true;
  if (tagName === "br" || tagName === "wbr") return false;
  return childNodesFor(node).length === 0 && attributes.length > 0;
}

function normalizedAttributes(node) {
  return (node.attrs ?? [])
    .filter((attribute) => !isRuntimeAttribute(attribute.name))
    .map((attribute) => ({
      name: String(attribute.name).toLowerCase(),
      value: String(attribute.value ?? ""),
    }))
    .sort((left, right) => (
      left.name.localeCompare(right.name) || left.value.localeCompare(right.value)
    ));
}

function stripRuntimeAttributesDeep(node) {
  if (typeof node?.tagName === "string") {
    node.attrs = (node.attrs ?? []).filter(
      (attribute) => !isRuntimeAttribute(attribute.name),
    );
  }
  for (const child of childNodesFor(node)) stripRuntimeAttributesDeep(child);
}

function protectedAttributeInventory(
  root,
  { authoredInlineAtomKeys = null } = {},
) {
  const inventory = new Map();
  const atomInventory = new Map();
  const comments = new Map();
  const visit = (node) => {
    if (node.nodeName === "#comment") {
      const key = String(node.data ?? "");
      comments.set(key, (comments.get(key) ?? 0) + 1);
    }
    if (typeof node.tagName === "string") {
      const tagName = node.tagName.toLowerCase();
      const attributes = normalizedAttributes(node);
      if (
        node.namespaceURI !== HTML_NAMESPACE
        || IMMUTABLE_EMBED_TAGS.has(tagName)
      ) {
        const key = `${tagName}\0${serializeOuter(node)}`;
        atomInventory.set(key, (atomInventory.get(key) ?? 0) + 1);
        return;
      }
      for (const attribute of attributes) {
        if (!isProtectedAttribute(attribute.name)) continue;
        const key = `${tagName}\0${attribute.name}\0${attribute.value}`;
        inventory.set(key, (inventory.get(key) ?? 0) + 1);
      }
      if (isImmutableAtomNode(node, tagName, attributes)) {
        const key = `${tagName}\0${JSON.stringify(attributes)}`;
        if (
          authoredInlineAtomKeys === null
          || authoredInlineAtomKeys.has(key)
        ) {
          atomInventory.set(key, (atomInventory.get(key) ?? 0) + 1);
        }
      }
    }
    for (const child of childNodesFor(node)) visit(child);
  };
  visit(root);
  return { inventory, atomInventory, comments };
}

function assertInventoryDoesNotGrow(next, baseline, code, message) {
  for (const [key, count] of next) {
    if (count > (baseline.get(key) ?? 0)) {
      fail(code, message, { key, baselineCount: baseline.get(key) ?? 0, nextCount: count });
    }
  }
}

function assertInventoryMatches(next, baseline, code, message) {
  const keys = new Set([...next.keys(), ...baseline.keys()]);
  for (const key of keys) {
    const nextCount = next.get(key) ?? 0;
    const baselineCount = baseline.get(key) ?? 0;
    if (nextCount !== baselineCount) {
      fail(code, message, { key, baselineCount, nextCount });
    }
  }
}

function sanitizeAndValidateFragment(fragment) {
  const visit = (node) => {
    if (typeof node.tagName === "string") {
      const tagName = node.tagName.toLowerCase();
      if (
        node.namespaceURI !== HTML_NAMESPACE
        || IMMUTABLE_EMBED_TAGS.has(tagName)
      ) {
        stripRuntimeAttributesDeep(node);
        return;
      }
      if (node.namespaceURI !== HTML_NAMESPACE || !INLINE_CONTENT_TAGS.has(tagName)) {
        fail(
          "EDITABLE_ISLAND_STRUCTURE_UNSUPPORTED",
          `Editable islands only accept inline HTML; <${tagName}> is outside the island schema.`,
          { tagName, namespaceURI: node.namespaceURI },
        );
      }
      node.attrs = normalizedAttributes(node);
    }
    for (const child of childNodesFor(node)) visit(child);
  };
  visit(fragment);
}

export function normalizeEditableIslandHtml(
  value,
  { baselineInnerHtml = "" } = {},
) {
  const baselineFragment = parseFragment(String(baselineInnerHtml));
  const nextFragment = parseFragment(String(value));
  sanitizeAndValidateFragment(baselineFragment);
  sanitizeAndValidateFragment(nextFragment);

  const baselineInventory = protectedAttributeInventory(baselineFragment);
  const nextInventory = protectedAttributeInventory(nextFragment, {
    authoredInlineAtomKeys: new Set(baselineInventory.atomInventory.keys()),
  });
  assertInventoryDoesNotGrow(
    nextInventory.inventory,
    baselineInventory.inventory,
    "EDITABLE_ISLAND_PROTECTED_ATTRIBUTE_ADDED",
    "Direct text editing cannot add identity, navigation, data or event attributes.",
  );
  assertInventoryMatches(
    nextInventory.atomInventory,
    baselineInventory.atomInventory,
    "EDITABLE_ISLAND_ATOM_CHANGED",
    "Direct text editing cannot add, remove or duplicate embedded media atoms.",
  );
  assertInventoryMatches(
    nextInventory.comments,
    baselineInventory.comments,
    "EDITABLE_ISLAND_COMMENT_CHANGED",
    "Direct text editing cannot add or remove source comments.",
  );

  return serialize(nextFragment);
}

function sourceDescendants(index, element) {
  const descendants = [];
  const pending = [...element.childIds];
  while (pending.length > 0) {
    const node = index.byNodeId.get(pending.shift());
    if (!node) continue;
    descendants.push(node);
    pending.unshift(...(node.childIds ?? []));
  }
  return descendants;
}

export function editableIslandForTarget(index, targetRef) {
  const resolution = resolveTargetRef(index, targetRef);
  const element = resolution.target;
  if (resolution.resolution !== "exact" || element?.type !== "element") {
    fail(
      resolution.resolution === "ambiguous"
        ? "EDITABLE_ISLAND_TARGET_AMBIGUOUS"
        : "EDITABLE_ISLAND_TARGET_ORPHANED",
      "Editable island target is not an exact source element.",
      { resolution: resolution.resolution },
    );
  }
  if (
    element.namespaceURI !== HTML_NAMESPACE
    || element.isVoid
    || !element.explicitEndTag
    || ROOT_BLOCKED_TAGS.has(element.tagName)
  ) {
    fail(
      "EDITABLE_ISLAND_ROOT_UNSUPPORTED",
      `The <${element.tagName}> element cannot own a V2 editable island.`,
      { nodeId: element.nodeId, tagName: element.tagName },
    );
  }

  for (const descendant of sourceDescendants(index, element)) {
    if (
      descendant.type === "element"
      && (
        (
          descendant.namespaceURI === HTML_NAMESPACE
          && !INLINE_CONTENT_TAGS.has(descendant.tagName)
          && !IMMUTABLE_EMBED_TAGS.has(descendant.tagName)
        )
      )
    ) {
      fail(
        "EDITABLE_ISLAND_STRUCTURE_UNSUPPORTED",
        `The island contains unsupported <${descendant.tagName}> structure.`,
        { nodeId: descendant.nodeId, tagName: descendant.tagName },
      );
    }
  }

  const innerHtml = index.source.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  return {
    targetRef,
    resolution: resolution.resolution,
    element,
    contentRange: { ...element.contentRange },
    innerHtml,
    normalizedInnerHtml: normalizeEditableIslandHtml(innerHtml, {
      baselineInnerHtml: innerHtml,
    }),
  };
}

export function isEditableIslandTarget(index, targetRef) {
  try {
    return {
      editable: true,
      island: editableIslandForTarget(index, targetRef),
      code: "EDITABLE_ISLAND_READY",
    };
  } catch (error) {
    if (!(error instanceof EditableIslandError)) throw error;
    return {
      editable: false,
      island: null,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
}
