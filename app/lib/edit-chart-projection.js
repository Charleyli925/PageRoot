import {
  EDIT_CHART_LIMITS,
  EDIT_CHART_SOURCE_CONTRACT,
  parseEditChartSpec,
  validateEditChartDocumentBudget,
  validateEditChartSlot,
} from "../domain/edit-chart-spec.js";
import {
  isEditChartSvgElementNameAllowed,
  isEditChartSvgAttributeAllowed,
  renderEditChartSvg,
  validateEditChartSvg,
} from "./edit-chart-svg.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  parseInlineStyle,
} from "./source-patch-core.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SHADOW_STYLE = `
  svg {
    display: block;
    width: 100%;
    height: auto;
    max-width: 100%;
    pointer-events: none !important;
    user-select: none !important;
  }
  svg * {
    pointer-events: none !important;
    user-select: none !important;
  }
`;

function fail(code) {
  return Object.freeze({ ok: false, code });
}

function singleAttributeValue(element, name) {
  const attributes = element.attributesByName?.get(name) ?? [];
  if (attributes.length !== 1) return null;
  const value = attributes[0].value ?? attributes[0].rawValue;
  return typeof value === "string" ? value : null;
}

function hasAttribute(element, name) {
  return (element.attributesByName?.get(name)?.length ?? 0) > 0;
}

function sourceElementIsEmpty(sourceIndex, element) {
  return element.childIds.every((nodeId) => {
    const child = sourceIndex.byNodeId.get(nodeId);
    return child?.type === "text" && child.whitespaceOnly === true;
  });
}

function templateJsonSource(sourceIndex, element) {
  if (element.tagName !== "template" || element.childIds.length === 0) return null;
  const pieces = [];
  for (const nodeId of element.childIds) {
    const child = sourceIndex.byNodeId.get(nodeId);
    if (child?.type !== "text") return null;
    pieces.push(child.value);
  }
  return pieces.join("");
}

function sourceAspectRatio(element) {
  const style = singleAttributeValue(element, "style");
  if (style === null) return null;
  const declarations = parseInlineStyle(style).filter(
    (declaration) => declaration.normalizedProperty === "aspect-ratio",
  );
  return declarations.length === 1 ? declarations[0].value : null;
}

function elementsByUniqueId(sourceIndex) {
  const byId = new Map();
  for (const element of sourceIndex.elements) {
    const id = singleAttributeValue(element, "id");
    if (id === null) continue;
    const matches = byId.get(id) ?? [];
    matches.push(element);
    byId.set(id, matches);
  }
  return byId;
}

function slotCandidateForSource(sourceIndex, host) {
  const attributes = EDIT_CHART_SOURCE_CONTRACT.attributes;
  return {
    tagName: host.tagName,
    hostId: singleAttributeValue(host, "id"),
    chartKind: singleAttributeValue(host, attributes.chartKind),
    specId: singleAttributeValue(host, attributes.specId),
    width: singleAttributeValue(host, attributes.width),
    height: singleAttributeValue(host, attributes.height),
    role: singleAttributeValue(host, "role"),
    ariaLabel: singleAttributeValue(host, "aria-label"),
    isSourceEmpty: sourceElementIsEmpty(sourceIndex, host),
    hasShadowRoot: false,
    aspectRatio: sourceAspectRatio(host),
  };
}

function freezeVisual(visual) {
  return Object.freeze({
    hostId: visual.hostId,
    hostNodeId: visual.hostNodeId,
    specId: visual.specId,
    specNodeId: visual.specNodeId,
    specSource: visual.specSource,
    slot: visual.slot,
    svg: visual.svg,
    svgBytes: visual.svgBytes,
  });
}

export function prepareEditChartProjection(sourceIndex) {
  if (
    !sourceIndex
    || typeof sourceIndex !== "object"
    || typeof sourceIndex.sourceSha256 !== "string"
    || !Array.isArray(sourceIndex.elements)
    || !(sourceIndex.byNodeId instanceof Map)
  ) return fail("edit-chart-projection-source-index-invalid");

  const chartAttribute = EDIT_CHART_SOURCE_CONTRACT.attributes.chartKind;
  const declaredHosts = sourceIndex.elements.filter(
    (element) => hasAttribute(element, chartAttribute),
  );
  if (declaredHosts.length === 0) {
    return Object.freeze({
      ok: true,
      sourceSha256: sourceIndex.sourceSha256,
      declaredCount: 0,
      visuals: Object.freeze([]),
      budget: null,
    });
  }
  if (declaredHosts.length > EDIT_CHART_LIMITS.chartsPerDocument) {
    return fail("edit-chart-projection-host-count-invalid");
  }

  const byId = elementsByUniqueId(sourceIndex);
  const referencedSpecIds = new Map();
  for (const host of declaredHosts) {
    const specId = singleAttributeValue(
      host,
      EDIT_CHART_SOURCE_CONTRACT.attributes.specId,
    );
    if (specId === null) continue;
    referencedSpecIds.set(specId, (referencedSpecIds.get(specId) ?? 0) + 1);
  }

  const candidates = [];
  for (const host of declaredHosts) {
    const slotCandidate = slotCandidateForSource(sourceIndex, host);
    const slotValidation = validateEditChartSlot(slotCandidate);
    if (!slotValidation.ok) continue;
    if (byId.get(slotValidation.slot.hostId)?.length !== 1) continue;
    if (referencedSpecIds.get(slotValidation.slot.specId) !== 1) continue;
    const templateMatches = byId.get(slotValidation.slot.specId) ?? [];
    if (templateMatches.length !== 1) continue;
    const template = templateMatches[0];
    if (
      template.tagName !== "template"
      || singleAttributeValue(
        template,
        EDIT_CHART_SOURCE_CONTRACT.attributes.specVersion,
      ) !== EDIT_CHART_SOURCE_CONTRACT.specVersion
    ) continue;
    const specSource = templateJsonSource(sourceIndex, template);
    if (specSource === null) continue;
    const specValidation = parseEditChartSpec(specSource);
    if (!specValidation.ok) continue;
    candidates.push({
      host,
      template,
      slotCandidate,
      slot: slotValidation.slot,
      specSource,
      spec: specValidation.spec,
      sourceBytes: specValidation.sourceBytes,
    });
  }

  if (candidates.length === 0) {
    return Object.freeze({
      ok: true,
      sourceSha256: sourceIndex.sourceSha256,
      declaredCount: declaredHosts.length,
      visuals: Object.freeze([]),
      budget: null,
    });
  }

  const sourceBudget = validateEditChartDocumentBudget(candidates.map((candidate) => ({
    sourceBytes: candidate.sourceBytes,
    spec: candidate.spec,
  })));
  if (!sourceBudget.ok) return fail(sourceBudget.code);

  const rendered = [];
  for (const candidate of candidates) {
    const result = renderEditChartSvg({
      slot: candidate.slotCandidate,
      spec: candidate.spec,
    });
    if (!result.ok) continue;
    rendered.push({ ...candidate, result });
  }
  if (rendered.length === 0) {
    return Object.freeze({
      ok: true,
      sourceSha256: sourceIndex.sourceSha256,
      declaredCount: declaredHosts.length,
      visuals: Object.freeze([]),
      budget: sourceBudget.budget,
    });
  }

  const renderedBudget = validateEditChartDocumentBudget(rendered.map((candidate) => ({
    sourceBytes: candidate.sourceBytes,
    spec: candidate.spec,
    svgBytes: candidate.result.bytes,
  })));
  if (!renderedBudget.ok) return fail(renderedBudget.code);

  return Object.freeze({
    ok: true,
    sourceSha256: sourceIndex.sourceSha256,
    declaredCount: declaredHosts.length,
    visuals: Object.freeze(rendered.map((candidate) => freezeVisual({
      hostId: candidate.slot.hostId,
      hostNodeId: candidate.host.nodeId,
      specId: candidate.slot.specId,
      specNodeId: candidate.template.nodeId,
      specSource: candidate.specSource,
      slot: candidate.slot,
      svg: candidate.result.svg,
      svgBytes: candidate.result.bytes,
    }))),
    budget: renderedBudget.budget,
  });
}

function liveNodesByAttribute(documentNode, attributeName) {
  const result = new Map();
  documentNode.querySelectorAll(`[${attributeName}]`).forEach((element) => {
    const value = element.getAttribute(attributeName);
    if (value === null) return;
    const matches = result.get(value) ?? [];
    matches.push(element);
    result.set(value, matches);
  });
  return result;
}

function liveNodesById(documentNode) {
  const result = new Map();
  documentNode.querySelectorAll("[id]").forEach((element) => {
    const id = element.getAttribute("id");
    if (id === null) return;
    const matches = result.get(id) ?? [];
    matches.push(element);
    result.set(id, matches);
  });
  return result;
}

function liveElementIsEmpty(element) {
  return [...element.childNodes].every(
    (node) => node.nodeType === 3 && String(node.nodeValue ?? "").trim() === "",
  );
}

function liveTemplateSource(template) {
  if (template.tagName.toLowerCase() !== "template" || !template.content) return null;
  const pieces = [];
  for (const node of template.content.childNodes) {
    if (node.nodeType !== 3) return null;
    pieces.push(node.nodeValue ?? "");
  }
  return pieces.length > 0 ? pieces.join("") : null;
}

function liveSlotCandidate(host) {
  const attributes = EDIT_CHART_SOURCE_CONTRACT.attributes;
  return {
    tagName: host.tagName.toLowerCase(),
    hostId: host.getAttribute("id"),
    chartKind: host.getAttribute(attributes.chartKind),
    specId: host.getAttribute(attributes.specId),
    width: host.getAttribute(attributes.width),
    height: host.getAttribute(attributes.height),
    role: host.getAttribute("role"),
    ariaLabel: host.getAttribute("aria-label"),
    isSourceEmpty: liveElementIsEmpty(host),
    hasShadowRoot: host.shadowRoot !== null,
    aspectRatio: host.style.getPropertyValue("aspect-ratio"),
  };
}

function sameSlot(left, right) {
  return [
    "tagName",
    "hostId",
    "chartKind",
    "specId",
    "width",
    "height",
    "role",
    "ariaLabel",
    "viewBox",
  ].every((key) => left[key] === right[key]);
}

function cloneValidatedSvgNode(node, documentNode) {
  if (node.nodeType === 3 || node.nodeType === 4) {
    return documentNode.createTextNode(node.nodeValue ?? "");
  }
  if (node.nodeType !== 1 || node.namespaceURI !== SVG_NAMESPACE) return null;
  const localName = node.localName.toLowerCase();
  if (!isEditChartSvgElementNameAllowed(localName)) return null;
  const clone = documentNode.createElementNS(SVG_NAMESPACE, localName);
  for (const attribute of node.attributes) {
    if (!isEditChartSvgAttributeAllowed(attribute.name, attribute.value)) return null;
    if (attribute.namespaceURI) {
      clone.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    } else {
      clone.setAttribute(attribute.name, attribute.value);
    }
  }
  for (const child of node.childNodes) {
    const childClone = cloneValidatedSvgNode(child, documentNode);
    if (!childClone) return null;
    clone.appendChild(childClone);
  }
  return clone;
}

function parseSvgForLiveDocument(documentNode, visual) {
  const validation = validateEditChartSvg(visual.svg, visual.slot);
  if (!validation.ok || validation.bytes !== visual.svgBytes) return null;
  const FrameDOMParser = documentNode.defaultView?.DOMParser;
  if (!FrameDOMParser) return null;
  const parsed = new FrameDOMParser().parseFromString(visual.svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return null;
  const sourceRoot = parsed.documentElement;
  if (
    !sourceRoot
    || sourceRoot.namespaceURI !== SVG_NAMESPACE
    || sourceRoot.localName.toLowerCase() !== "svg"
  ) return null;
  const clone = cloneValidatedSvgNode(sourceRoot, documentNode);
  if (!clone || clone.localName.toLowerCase() !== "svg") return null;
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("focusable", "false");
  clone.setAttribute("tabindex", "-1");
  return clone;
}

function prepareLiveMount(documentNode, visual, bySourceNodeId, byId) {
  const hostMatches = bySourceNodeId.get(visual.hostNodeId) ?? [];
  const templateMatches = bySourceNodeId.get(visual.specNodeId) ?? [];
  if (hostMatches.length !== 1 || templateMatches.length !== 1) return null;
  if (
    byId.get(visual.hostId)?.length !== 1
    || byId.get(visual.specId)?.length !== 1
  ) return null;
  const host = hostMatches[0];
  const template = templateMatches[0];
  if (!(host instanceof documentNode.defaultView.HTMLElement)) return null;
  const slotValidation = validateEditChartSlot(liveSlotCandidate(host));
  if (!slotValidation.ok || !sameSlot(slotValidation.slot, visual.slot)) return null;
  if (
    template.getAttribute(EDIT_CHART_SOURCE_CONTRACT.attributes.specVersion)
      !== EDIT_CHART_SOURCE_CONTRACT.specVersion
    || liveTemplateSource(template) !== visual.specSource
  ) return null;
  const svg = parseSvgForLiveDocument(documentNode, visual);
  return svg ? { host, svg } : null;
}

export function mountEditChartProjection(documentNode, projection) {
  if (
    !documentNode?.documentElement
    || !documentNode.defaultView
    || !projection?.ok
    || !Array.isArray(projection.visuals)
  ) return Object.freeze({ mounted: 0, skipped: 0 });
  if (projection.visuals.length === 0) {
    return Object.freeze({ mounted: 0, skipped: 0 });
  }

  const bySourceNodeId = liveNodesByAttribute(documentNode, SOURCE_NODE_ATTRIBUTE);
  const byId = liveNodesById(documentNode);
  const prepared = projection.visuals.map(
    (visual) => prepareLiveMount(documentNode, visual, bySourceNodeId, byId),
  );
  let mounted = 0;
  for (const item of prepared) {
    if (!item) continue;
    try {
      const shadowRoot = item.host.attachShadow({ mode: "open" });
      const style = documentNode.createElement("style");
      style.textContent = SHADOW_STYLE;
      shadowRoot.append(style, item.svg);
      mounted += 1;
    } catch {
      // The source Canvas remains authoritative and usable; an individual
      // projection failure is intentionally a silent no-op.
    }
  }
  return Object.freeze({
    mounted,
    skipped: projection.visuals.length - mounted,
  });
}
