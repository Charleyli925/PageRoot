import { parseFragment, serialize, serializeOuter } from "parse5";

import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  generatePagerootElementId,
  isValidPagerootElementId,
} from "./pageroot-element-identity.mjs";
export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export const HTML_VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

export const PLAIN_TEXT_RAW_TAGS = new Set([
  "script",
  "style",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
]);

export const ROOT_BLOCKED_TAGS = new Set([
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

export const INLINE_CONTENT_TAGS = new Set([
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

const IMMUTABLE_ATOM_TAGS = new Set(["img", "wbr"]);
export const IMMUTABLE_EMBED_TAGS = new Set([
  "audio",
  "canvas",
  "embed",
  "iframe",
  "input",
  "math",
  "object",
  "ol",
  "select",
  "svg",
  "textarea",
  "ul",
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

function escapePlainText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function planSemanticPlainTextPatch(source, {
  tagName,
  isVoid = false,
  contentStartOffset,
  contentEndOffset,
  text,
}) {
  const normalizedTagName = String(tagName ?? "").toLowerCase();
  if (
    !normalizedTagName
    || isVoid
    || HTML_VOID_TAGS.has(normalizedTagName)
    || PLAIN_TEXT_RAW_TAGS.has(normalizedTagName)
  ) {
    fail(
      "SEMANTIC_TEXT_TARGET_UNSUPPORTED",
      "setText requires a non-void authored text container.",
      { tagName: normalizedTagName || null },
    );
  }
  const value = String(source);
  if (
    !Number.isInteger(contentStartOffset)
    || !Number.isInteger(contentEndOffset)
    || contentStartOffset < 0
    || contentEndOffset < contentStartOffset
    || contentEndOffset > value.length
  ) {
    fail(
      "SEMANTIC_TEXT_TARGET_UNSUPPORTED",
      "setText requires exact authored content boundaries.",
      { tagName: normalizedTagName },
    );
  }
  return {
    startOffset: contentStartOffset,
    endOffset: contentEndOffset,
    before: value.slice(contentStartOffset, contentEndOffset),
    after: escapePlainText(text),
    kind: "semantic:set-text",
  };
}

function childNodesFor(node) {
  if (node?.nodeName === "template" && node.content) return node.content.childNodes ?? [];
  return node?.childNodes ?? [];
}

function isRuntimeAttribute(name) {
  const normalized = String(name ?? "").toLowerCase();
  if (normalized === PAGEROOT_ELEMENT_ID_ATTRIBUTE) return false;
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
  if (tagName === "br") return false;
  const authoredAttributes = attributes.filter(
    (attribute) => attribute.name !== PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  );
  return childNodesFor(node).length === 0 && authoredAttributes.length > 0;
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
  const identities = new Map();
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
        if (attribute.name === PAGEROOT_ELEMENT_ID_ATTRIBUTE) {
          const key = attribute.value;
          identities.set(key, (identities.get(key) ?? 0) + 1);
          continue;
        }
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
  return { inventory, identities, atomInventory, comments };
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

function assertInventoryPreserved(next, baseline, code, message) {
  for (const [key, count] of baseline) {
    if ((next.get(key) ?? 0) !== count) {
      fail(code, message, { key, baselineCount: count, nextCount: next.get(key) ?? 0 });
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
  assertInventoryPreserved(
    nextInventory.identities,
    baselineInventory.identities,
    "EDITABLE_ISLAND_PERSISTENT_ID_CHANGED",
    "Direct text editing cannot change or remove persistent element identities.",
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

function editableIslandElements(root) {
  const elements = [];
  const visit = (node) => {
    if (typeof node?.tagName === "string") elements.push(node);
    for (const child of childNodesFor(node)) visit(child);
  };
  visit(root);
  return elements;
}

function persistentElementId(node) {
  return (node.attrs ?? []).find(
    (attribute) => attribute.name === PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  )?.value ?? null;
}

export function materializeEditableIslandHtml(
  value,
  {
    baselineInnerHtml = "",
    replayPagerootIds = null,
    randomUUID,
  } = {},
) {
  const normalized = normalizeEditableIslandHtml(value, { baselineInnerHtml });
  const baseline = parseFragment(String(baselineInnerHtml));
  const next = parseFragment(normalized);
  sanitizeAndValidateFragment(baseline);
  sanitizeAndValidateFragment(next);
  const baselineIds = new Set(
    editableIslandElements(baseline).map(persistentElementId).filter(Boolean),
  );
  const nextElements = editableIslandElements(next);
  const nextExistingIdCounts = new Map();
  for (const node of nextElements) {
    const elementId = persistentElementId(node);
    if (!baselineIds.has(elementId)) continue;
    nextExistingIdCounts.set(elementId, (nextExistingIdCounts.get(elementId) ?? 0) + 1);
  }
  if ([...nextExistingIdCounts.values()].some((count) => count !== 1)) {
    fail(
      "EDITABLE_ISLAND_PERSISTENT_ID_CHANGED",
      "Direct text editing cannot duplicate a persistent element identity.",
    );
  }
  const newElements = nextElements.filter((node) => {
    const elementId = persistentElementId(node);
    return !elementId || !baselineIds.has(elementId);
  });
  if (newElements.some((node) => node.tagName.toLowerCase() !== "br")) {
    fail(
      "EDITABLE_ISLAND_NEW_ELEMENT_UNSUPPORTED",
      "Direct text editing can allocate identity only for a new line-break element.",
    );
  }
  const replayIds = replayPagerootIds === null
    ? null
    : Array.isArray(replayPagerootIds) ? replayPagerootIds.map(String) : [];
  if (replayIds && replayIds.length !== newElements.length) {
    fail(
      "EDITABLE_ISLAND_IDENTITY_EVIDENCE_MISMATCH",
      "Line-break identity evidence does not match the editable-island result.",
    );
  }
  const reservedIds = new Set([
    ...baselineIds,
    ...nextElements.map(persistentElementId).filter(Boolean),
  ]);
  const allocatedIds = new Set();
  const createdPagerootIds = newElements.map((node, index) => {
    const authoredId = persistentElementId(node);
    if (authoredId && !replayIds) {
      fail(
        "EDITABLE_ISLAND_IDENTITY_ADDED",
        "Runtime editable HTML cannot author a persistent element identity.",
      );
    }
    const elementId = replayIds?.[index]
      ?? generatePagerootElementId(randomUUID);
    if (
      !isValidPagerootElementId(elementId)
      || baselineIds.has(elementId)
      || allocatedIds.has(elementId)
      || (!authoredId && reservedIds.has(elementId))
      || (authoredId && authoredId !== elementId)
    ) {
      fail(
        "EDITABLE_ISLAND_IDENTITY_EVIDENCE_MISMATCH",
        "A line-break requires one fresh kernel-owned persistent identity.",
      );
    }
    if (!authoredId) {
      node.attrs = [
        ...(node.attrs ?? []),
        { name: PAGEROOT_ELEMENT_ID_ATTRIBUTE, value: elementId },
      ];
    }
    allocatedIds.add(elementId);
    reservedIds.add(elementId);
    return elementId;
  });
  if (new Set(createdPagerootIds).size !== createdPagerootIds.length) {
    fail(
      "EDITABLE_ISLAND_IDENTITY_EVIDENCE_MISMATCH",
      "Line-break identities must be unique within the edit.",
    );
  }
  return {
    html: serialize(next),
    createdPagerootIds,
  };
}

export function editableIslandDraftHtml(
  value,
  { baselineInnerHtml = "" } = {},
) {
  const normalized = normalizeEditableIslandHtml(value, { baselineInnerHtml });
  const baseline = parseFragment(String(baselineInnerHtml));
  const next = parseFragment(normalized);
  sanitizeAndValidateFragment(baseline);
  sanitizeAndValidateFragment(next);
  const baselineIds = new Set(
    editableIslandElements(baseline).map(persistentElementId).filter(Boolean),
  );
  for (const node of editableIslandElements(next)) {
    const elementId = persistentElementId(node);
    if (!elementId || baselineIds.has(elementId)) continue;
    if (node.tagName.toLowerCase() !== "br") {
      fail(
        "EDITABLE_ISLAND_NEW_ELEMENT_UNSUPPORTED",
        "Only a system-identified line break can be projected back to an editable draft.",
      );
    }
    node.attrs = (node.attrs ?? []).filter(
      (attribute) => attribute.name !== PAGEROOT_ELEMENT_ID_ATTRIBUTE,
    );
  }
  return normalizeEditableIslandHtml(serialize(next), { baselineInnerHtml });
}

export function normalizeEditableTextFragmentHtml(
  value,
  { baselineInnerHtml = "" } = {},
) {
  const normalized = normalizeEditableIslandHtml(value, { baselineInnerHtml });
  const fragment = parseFragment(normalized);
  const unsupported = childNodesFor(fragment).find(
    (node) => node.nodeName !== "#text",
  );
  if (unsupported) {
    fail(
      "EDITABLE_TEXT_FRAGMENT_STRUCTURE_UNSUPPORTED",
      "A direct source text fragment can only contain plain text.",
      { nodeName: unsupported.nodeName },
    );
  }
  return serialize(fragment);
}
