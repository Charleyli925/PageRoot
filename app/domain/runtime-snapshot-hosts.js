import { EDIT_AUTHOR_RUNTIME_BUDGET } from "./edit-runtime-contract.js";
import { buildSourceIndex } from "../lib/source-index.js";
import {
  createTargetRef,
} from "../lib/target-resolver.js";

export const EDIT_RUNTIME_HOST_LIMIT = EDIT_AUTHOR_RUNTIME_BUDGET.hostCount;
const DIRECT_HOST_KINDS = new Map([
  ["canvas", "canvas"],
  ["svg", "svg"],
]);
const EDIT_RUNTIME_DANGEROUS_HOST_TAGS = new Set([
  "audio",
  "base",
  "body",
  "button",
  "dialog",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "html",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "option",
  "script",
  "select",
  "source",
  "style",
  "textarea",
  "track",
  "video",
]);
const EXCLUDED_STABLE_ATTRIBUTES = new Set([
  "class",
  "id",
  "name",
  "aria-label",
]);
function sourceIndexFor(html, supplied) {
  return supplied?.source === html
    && Array.isArray(supplied.elements)
    && supplied.byNodeId instanceof Map
    ? supplied
    : buildSourceIndex(html);
}

function attributeValue(element, name) {
  const attributes = element.attributesByName?.get(name) || [];
  return attributes.length === 1 ? String(attributes[0].value ?? "") : null;
}

function elementPath(index, element) {
  const path = [];
  let current = element;
  while (current?.parentId) {
    const parent = index.byNodeId.get(current.parentId);
    if (!parent || parent.type !== "element") return null;
    let position = parent.childElementIds.indexOf(current.nodeId);
    if (position < 0) return null;
    // SourceIndex intentionally models only authored nodes. Browser/parse5
    // DOMs insert an empty <head> before an authored <body>, so the owner path
    // must use browser child positions rather than the raw source child array.
    if (
      parent.tagName === "html"
      && current.tagName === "body"
      && !parent.childElementIds.some((nodeId) => (
        index.byNodeId.get(nodeId)?.tagName === "head"
      ))
    ) position = 1;
    path.unshift(position);
    current = parent;
    if (path.length > 256) return null;
  }
  return current?.tagName === "html" ? Object.freeze(path) : null;
}

function sourceContentIsEmpty(index, element) {
  if (!element?.contentRange) return false;
  const content = index.source.slice(
    element.contentRange.startOffset,
    element.contentRange.endOffset,
  );
  return content.replace(/<!--[\s\S]*?-->/gu, "").trim().length === 0;
}

function uniqueAttribute(index, element, name, value) {
  if (!value || value.length > 2_048) return false;
  return index.elements.filter((candidate) => (
    attributeValue(candidate, name) === value
  )).length === 1;
}

function uniqueClassBinding(index, element) {
  const classValue = attributeValue(element, "class");
  if (!classValue || classValue.length > 2_048) return null;
  const tokens = classValue.split(/[\t\n\f\r ]+/u).filter(Boolean);
  const uniqueToken = tokens.find((token) => (
    token.length >= 3
    && index.elements.filter((candidate) => (
      (attributeValue(candidate, "class") || "")
        .split(/[\t\n\f\r ]+/u)
        .includes(token)
    )).length === 1
  ));
  return uniqueToken ? Object.freeze([["class", classValue]]) : null;
}

function stableBinding(index, element) {
  for (const name of ["id", "name", "aria-label"]) {
    const value = attributeValue(element, name);
    if (value && uniqueAttribute(index, element, name, value)) {
      return Object.freeze([[name, value]]);
    }
  }
  for (const attribute of element.attributes || []) {
    if (
      !attribute.name.startsWith("data-")
      || attribute.name.startsWith("data-pageroot-")
      || EXCLUDED_STABLE_ATTRIBUTES.has(attribute.name)
    ) continue;
    const value = String(attribute.value ?? "");
    if (uniqueAttribute(index, element, attribute.name, value)) {
      return Object.freeze([[attribute.name, value]]);
    }
  }
  return uniqueClassBinding(index, element) || Object.freeze([]);
}

function editRuntimeHostDescriptor(index, element) {
  const directKind = DIRECT_HOST_KINDS.get(element?.tagName);
  const directHostIsEligible = (
    directKind === "canvas" && element.childElementIds.length === 0
  )
    || (directKind === "svg" && sourceContentIsEmpty(index, element));
  if (
    !element
    || element.type !== "element"
    || EDIT_RUNTIME_DANGEROUS_HOST_TAGS.has(element.tagName)
    || (directKind ? !directHostIsEligible : !sourceContentIsEmpty(index, element))
  ) return null;
  const binding = stableBinding(index, element);
  if (!binding.length) return null;
  const path = elementPath(index, element);
  if (!path) return null;
  let hostTargetRef;
  try {
    hostTargetRef = createTargetRef(index, element, { level: "subregion" });
  } catch {
    return null;
  }
  return Object.freeze({
    sourceNodeId: element.nodeId,
    kind: directKind || "host",
    hostTargetRef: Object.freeze({ ...hostTargetRef }),
    binding: Object.freeze({
      path,
      tagName: element.tagName,
      kind: directKind || "host",
      identityAttributes: binding,
    }),
  });
}

function normalizedHostBinding(host) {
  const binding = host?.binding;
  if (!binding) return null;
  return {
    path: [...binding.path],
    tagName: binding.tagName,
    kind: binding.kind,
    identityAttributes: binding.identityAttributes.map(([name, value]) => [name, value]),
  };
}

/**
 * Converts one resolver result into the sole narrow owner request shape. The
 * request carries source-backed binding data only; target references remain in
 * trusted renderer memory.
 */
export function editRuntimeCaptureCandidate(key, host) {
  const binding = normalizedHostBinding(host);
  if (
    typeof key !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(key)
    || !binding
  ) return null;
  return Object.freeze({
    key,
    path: Object.freeze(binding.path),
    tagName: binding.tagName,
    kind: binding.kind,
    identityAttributes: Object.freeze(
      binding.identityAttributes.map(([name, value]) => Object.freeze([name, value])),
    ),
  });
}

/**
 * Edit-only discovery has one source, because a one-shot frame never attempts
 * to rebind after a save, comment change, or later static reload. Its runtime
 * descendants stay display-only and map back to these source hosts.
 */
export function resolveEditRuntimeHosts({
  html,
  sourceIndex: suppliedSourceIndex = null,
  maximum = EDIT_RUNTIME_HOST_LIMIT,
} = {}) {
  if (typeof html !== "string") return null;
  let sourceIndex;
  try {
    sourceIndex = sourceIndexFor(html, suppliedSourceIndex);
  } catch {
    return null;
  }
  const limit = Number.isSafeInteger(maximum)
    ? Math.max(0, Math.min(EDIT_RUNTIME_HOST_LIMIT, maximum))
    : EDIT_RUNTIME_HOST_LIMIT;
  const hosts = [];
  for (const element of sourceIndex.elements) {
    if (hosts.length >= limit) break;
    const host = editRuntimeHostDescriptor(sourceIndex, element);
    if (host) hosts.push(host);
  }
  return Object.freeze({
    sourceIndex,
    hosts: Object.freeze(hosts),
  });
}
