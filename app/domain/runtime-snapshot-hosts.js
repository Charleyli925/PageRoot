import { RUNTIME_VISUAL_CONTRACT } from "./runtime-visual-contract.js";
import { EDIT_AUTHOR_RUNTIME_BUDGET } from "./edit-runtime-contract.js";
import { buildSourceIndex } from "../lib/source-index.js";
import {
  createTargetRef,
  resolveTargetRef,
} from "../lib/target-resolver.js";

export const RUNTIME_SNAPSHOT_HOST_LIMIT =
  RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit;
// Enumeration may look further than the per-page capture budget so a caller
// can prioritize comment-anchored hosts before truncating to the budget.
export const RUNTIME_SNAPSHOT_HOST_ENUMERATION_LIMIT =
  RUNTIME_VISUAL_CONTRACT.candidateLimit;
export const EDIT_RUNTIME_HOST_LIMIT = EDIT_AUTHOR_RUNTIME_BUDGET.hostCount;

const DIRECT_HOST_KINDS = new Map([
  ["canvas", "canvas"],
  ["svg", "svg"],
]);
const STABLE_HOST_TAGS = new Set([
  "article",
  "aside",
  "div",
  "figure",
  "li",
  "main",
  "section",
  "span",
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

function elementAtPath(index, path) {
  const root = index.elements.find((element) => (
    element.tagName === "html" && !element.parentId
  ));
  if (!root) return null;
  let current = root;
  for (const position of path) {
    let sourcePosition = position;
    if (
      current.tagName === "html"
      && !current.childElementIds.some((nodeId) => (
        index.byNodeId.get(nodeId)?.tagName === "head"
      ))
    ) {
      if (position === 0) return null;
      sourcePosition = position - 1;
    }
    const childId = current.childElementIds[sourcePosition];
    const child = childId ? index.byNodeId.get(childId) : null;
    if (!child || child.type !== "element") return null;
    current = child;
  }
  return current;
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

function hostDescriptor(index, element) {
  if (!element || element.type !== "element") return null;
  const directKind = DIRECT_HOST_KINDS.get(element.tagName);
  const binding = stableBinding(index, element);
  const kind = directKind || (
    STABLE_HOST_TAGS.has(element.tagName)
    && sourceContentIsEmpty(index, element)
    && binding.length > 0
      ? "host"
      : null
  );
  if (!kind) return null;
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
    kind,
    hostTargetRef: Object.freeze({ ...hostTargetRef }),
    binding: Object.freeze({
      path,
      tagName: element.tagName,
      kind,
      identityAttributes: binding,
    }),
  });
}

/**
 * Edit uses a separate source-empty-host rule. Review stays on its strict
 * historical allowlist; this path rejects global/executable host surfaces
 * while still requiring one unique source binding before runtime descendants
 * may be created inside the host.
 */
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

function compatibleHost(beforeHost, afterHost) {
  return Boolean(afterHost)
    && beforeHost.kind === afterHost.kind
    && beforeHost.binding.tagName === afterHost.binding.tagName;
}

function pairedAfterHost(beforeHost, afterIndex) {
  try {
    const resolution = resolveTargetRef(afterIndex, beforeHost.hostTargetRef);
    if (
      resolution.resolution !== "ambiguous"
      && resolution.resolution !== "orphaned"
      && resolution.target?.type === "element"
    ) {
      const afterHost = hostDescriptor(afterIndex, resolution.target);
      if (compatibleHost(beforeHost, afterHost)) return afterHost;
    }
  } catch {
    // A source host that cannot be rebound is intentionally omitted.
  }

  // Direct authored Canvas/SVG roots remain useful even without a stable
  // attribute. Their exact source-element path is a conservative fallback;
  // ordinary source-empty containers never use this positional route.
  if (beforeHost.kind === "host") return null;
  const atSamePath = elementAtPath(afterIndex, beforeHost.binding.path);
  const afterHost = hostDescriptor(afterIndex, atSamePath);
  return compatibleHost(beforeHost, afterHost) ? afterHost : null;
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
export function runtimeSnapshotCaptureCandidate(key, host) {
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
 * Enumerates only source-backed Canvas/SVG roots and source-empty hosts with a
 * unique stable attribute. Pairing starts from a before-side TargetRef; no
 * runtime DOM selector, script parser, comment scope or computed selector is
 * involved in candidate discovery.
 */
export function resolveRuntimeSnapshotHosts({
  beforeHtml,
  afterHtml,
  beforeIndex: suppliedBeforeIndex = null,
  afterIndex: suppliedAfterIndex = null,
  maximum = RUNTIME_SNAPSHOT_HOST_LIMIT,
} = {}) {
  if (typeof beforeHtml !== "string" || typeof afterHtml !== "string") return null;
  let beforeIndex;
  let afterIndex;
  try {
    beforeIndex = sourceIndexFor(beforeHtml, suppliedBeforeIndex);
    afterIndex = sourceIndexFor(afterHtml, suppliedAfterIndex);
  } catch {
    return null;
  }
  const limit = Number.isSafeInteger(maximum)
    ? Math.max(0, Math.min(RUNTIME_SNAPSHOT_HOST_ENUMERATION_LIMIT, maximum))
    : RUNTIME_SNAPSHOT_HOST_LIMIT;
  const hosts = [];
  for (const element of beforeIndex.elements) {
    if (hosts.length >= limit) break;
    const before = hostDescriptor(beforeIndex, element);
    if (!before) continue;
    const after = pairedAfterHost(before, afterIndex);
    if (!after) continue;
    hosts.push(Object.freeze({ before, after }));
  }
  return Object.freeze({
    beforeIndex,
    afterIndex,
    hosts: Object.freeze(hosts),
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
