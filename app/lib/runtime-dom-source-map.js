export const RUNTIME_NODE_ATTRIBUTE = "data-pageroot-runtime-node";

export class RuntimeDomSourceMapError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RuntimeDomSourceMapError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new RuntimeDomSourceMapError(code, message, details);
}

function assertNode(node) {
  if ((typeof node !== "object" && typeof node !== "function") || node === null) {
    fail("INVALID_RUNTIME_NODE", "A DOM node-like object is required.");
  }
}

function nodeText(node) {
  if (typeof node.data === "string") return node.data;
  if (typeof node.nodeValue === "string") return node.nodeValue;
  return typeof node.textContent === "string" ? node.textContent : "";
}

function nodeChildren(node) {
  return Array.from(node?.childNodes ?? []);
}

function isUtf16Boundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff);
}

function assertDomOffset(node, offset) {
  const value = nodeText(node);
  if (!Number.isInteger(offset) || offset < 0 || offset > value.length) {
    fail(
      "DOM_OFFSET_OUT_OF_RANGE",
      "The DOM offset is outside its text node.",
      { offset, textLength: value.length },
    );
  }
  if (!isUtf16Boundary(value, offset)) {
    fail(
      "UNSAFE_DOM_UTF16_BOUNDARY",
      "The DOM offset splits a UTF-16 surrogate pair.",
      { offset },
    );
  }
}

function assertAffinity(affinity) {
  if (affinity !== "left" && affinity !== "right") {
    fail("INVALID_RUNTIME_AFFINITY", "Runtime affinity must be left or right.");
  }
}

function textAnchor(textNodeId, utf16Offset, affinity) {
  return { kind: "text", textNodeId, utf16Offset, affinity };
}

function normalizeTextSpans(node, spans) {
  const textLength = nodeText(node).length;
  if (!Array.isArray(spans)) {
    fail("INVALID_DOM_SOURCE_SPANS", "Text bindings require a spans array.");
  }
  const normalized = spans.map((span, index) => {
    const next = {
      domStart: Number(span?.domStart),
      domEnd: Number(span?.domEnd),
      textNodeId: String(span?.textNodeId ?? ""),
      sourceStartOffset: Number(span?.sourceStartOffset),
      sourceEndOffset: Number(span?.sourceEndOffset),
    };
    if (
      !Number.isInteger(next.domStart)
      || !Number.isInteger(next.domEnd)
      || !Number.isInteger(next.sourceStartOffset)
      || !Number.isInteger(next.sourceEndOffset)
      || next.domStart < 0
      || next.domEnd <= next.domStart
      || next.domEnd > textLength
      || next.sourceStartOffset < 0
      || next.sourceEndOffset <= next.sourceStartOffset
      || !next.textNodeId
      || next.domEnd - next.domStart
        !== next.sourceEndOffset - next.sourceStartOffset
    ) {
      fail(
        "INVALID_DOM_SOURCE_SPAN",
        "A DOM/source span must describe equal, non-empty UTF-16 ranges.",
        { index, span },
      );
    }
    if (
      !isUtf16Boundary(nodeText(node), next.domStart)
      || !isUtf16Boundary(nodeText(node), next.domEnd)
    ) {
      fail(
        "UNSAFE_DOM_SOURCE_SPAN",
        "A DOM/source span splits a UTF-16 surrogate pair.",
        { index, span },
      );
    }
    return next;
  }).sort((left, right) => left.domStart - right.domStart);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].domStart < normalized[index - 1].domEnd) {
      fail(
        "OVERLAPPING_DOM_SOURCE_SPANS",
        "DOM/source spans must not overlap.",
      );
    }
  }
  const complete = textLength === 0
    ? normalized.length === 0
    : normalized.length > 0
      && normalized[0].domStart === 0
      && normalized.at(-1).domEnd === textLength
      && normalized.every((span, index) => (
        index === 0 || normalized[index - 1].domEnd === span.domStart
      ));
  return { spans: normalized, complete };
}

function isWithinRoot(node, root) {
  if (!root) return true;
  if (node === root) return true;
  if (typeof root.contains === "function") return root.contains(node);
  let cursor = node?.parentNode ?? null;
  while (cursor) {
    if (cursor === root) return true;
    cursor = cursor.parentNode ?? null;
  }
  return false;
}

function mergeSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous
      && previous.textNodeId === segment.textNodeId
      && previous.endOffset === segment.startOffset
    ) {
      previous.endOffset = segment.endOffset;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/**
 * Session-local identity and range mapping for the real authored DOM. Runtime
 * IDs and WeakMap bindings never enter the user's HTML source.
 */
export class RuntimeDomSourceMap {
  constructor(options = {}) {
    this.epoch = String(options.epoch ?? "document-1");
    this.idPrefix = String(options.idPrefix ?? "runtime");
    this.nextId = 1;
    this.bindings = new WeakMap();
    this.records = new Map();
    this.textSequences = new WeakMap();
  }

  createRuntimeId() {
    const runtimeId = `${this.idPrefix}:${this.epoch}:${this.nextId}`;
    this.nextId += 1;
    return runtimeId;
  }

  bindElement(node, binding = {}, options = {}) {
    assertNode(node);
    const sourceNodeId = String(binding.sourceNodeId ?? "");
    if (!sourceNodeId) {
      fail("ELEMENT_SOURCE_NODE_REQUIRED", "Element bindings require a source node ID.");
    }
    const record = this.bindings.get(node);
    const runtimeId = record?.runtimeId ?? this.createRuntimeId();
    const next = {
      kind: "element",
      runtimeId,
      sourceNodeId,
      targetRef: binding.targetRef ?? null,
    };
    this.bindings.set(node, next);
    this.records.set(runtimeId, { node, binding: next });
    if (options.exposeAttribute === true && typeof node.setAttribute === "function") {
      node.setAttribute(RUNTIME_NODE_ATTRIBUTE, runtimeId);
    }
    return runtimeId;
  }

  bindText(node, binding = {}) {
    assertNode(node);
    const normalized = normalizeTextSpans(node, binding.spans ?? []);
    const record = this.bindings.get(node);
    const runtimeId = record?.runtimeId ?? this.createRuntimeId();
    const next = {
      kind: "text",
      runtimeId,
      spans: normalized.spans,
      complete: normalized.complete,
      emptyAnchor: binding.emptyAnchor ?? null,
    };
    if (nodeText(node).length === 0 && !next.emptyAnchor) {
      next.complete = false;
    }
    this.bindings.set(node, next);
    this.records.set(runtimeId, { node, binding: next });
    return runtimeId;
  }

  bindTextSequence(root, entries) {
    assertNode(root);
    if (!Array.isArray(entries)) {
      fail("INVALID_TEXT_SEQUENCE", "A text sequence entries array is required.");
    }
    const runtimeIds = entries.map((entry) => {
      if (!isWithinRoot(entry?.node, root)) {
        fail(
          "TEXT_NODE_OUTSIDE_ROOT",
          "A bound text node is outside the editing root.",
        );
      }
      return this.bindText(entry.node, entry);
    });
    if (new Set(runtimeIds).size !== runtimeIds.length) {
      fail("DUPLICATE_TEXT_NODE", "A text sequence cannot contain a node twice.");
    }
    this.textSequences.set(root, runtimeIds);
    return runtimeIds;
  }

  rebindRuntimeNode(runtimeId, nextNode, nextBinding = null) {
    assertNode(nextNode);
    const current = this.records.get(runtimeId);
    if (!current) {
      fail(
        "RUNTIME_NODE_NOT_FOUND",
        "The runtime node ID is not registered in this document epoch.",
        { runtimeId },
      );
    }
    this.bindings.delete(current.node);
    let binding;
    if (current.binding.kind === "text") {
      const input = nextBinding ?? current.binding;
      const normalized = normalizeTextSpans(nextNode, input.spans ?? []);
      binding = {
        kind: "text",
        runtimeId,
        spans: normalized.spans,
        complete: normalized.complete,
        emptyAnchor: input.emptyAnchor ?? null,
      };
      if (nodeText(nextNode).length === 0 && !binding.emptyAnchor) binding.complete = false;
    } else {
      const input = nextBinding ?? current.binding;
      const sourceNodeId = String(input.sourceNodeId ?? "");
      if (!sourceNodeId) {
        fail("ELEMENT_SOURCE_NODE_REQUIRED", "Element bindings require a source node ID.");
      }
      binding = {
        kind: "element",
        runtimeId,
        sourceNodeId,
        targetRef: input.targetRef ?? null,
      };
    }
    this.bindings.set(nextNode, binding);
    this.records.set(runtimeId, { node: nextNode, binding });
    return binding;
  }

  unbindNode(node) {
    const binding = this.bindings.get(node);
    if (!binding) return false;
    this.bindings.delete(node);
    const record = this.records.get(binding.runtimeId);
    if (record?.node === node) this.records.delete(binding.runtimeId);
    return true;
  }

  bindingForNode(node) {
    return this.bindings.get(node) ?? null;
  }

  runtimeIdForNode(node) {
    return this.bindings.get(node)?.runtimeId ?? null;
  }

  nodeForRuntimeId(runtimeId) {
    return this.records.get(runtimeId)?.node ?? null;
  }

  bindingForRuntimeId(runtimeId) {
    return this.records.get(runtimeId)?.binding ?? null;
  }

  domPointToSourceAnchor(node, offset, affinity = "right") {
    assertNode(node);
    assertAffinity(affinity);
    const binding = this.bindings.get(node);
    if (!binding) {
      fail("UNMAPPED_DOM_NODE", "The DOM point is not source-mapped.");
    }
    if (binding.kind === "text") {
      assertDomOffset(node, offset);
      if (nodeText(node).length === 0 && binding.emptyAnchor) {
        return { ...binding.emptyAnchor, affinity };
      }
      const interior = binding.spans.find(
        (span) => offset > span.domStart && offset < span.domEnd,
      );
      const left = [...binding.spans].reverse().find((span) => span.domEnd === offset);
      const right = binding.spans.find((span) => span.domStart === offset);
      const span = interior ?? (affinity === "left" ? left ?? right : right ?? left);
      if (!span) {
        fail(
          "UNMAPPED_DOM_POINT",
          "The DOM point falls in an unmapped text gap.",
          { runtimeId: binding.runtimeId, offset },
        );
      }
      return textAnchor(
        span.textNodeId,
        span.sourceStartOffset + offset - span.domStart,
        affinity,
      );
    }

    const children = nodeChildren(node);
    if (!Number.isInteger(offset) || offset < 0 || offset > children.length) {
      fail(
        "DOM_CHILD_OFFSET_OUT_OF_RANGE",
        "The DOM child offset is outside its element.",
        { offset, childCount: children.length },
      );
    }
    const beforeNode = children[offset] ?? null;
    const beforeBinding = beforeNode ? this.bindings.get(beforeNode) : null;
    const beforeNodeId = beforeBinding?.kind === "element"
      ? beforeBinding.sourceNodeId
      : beforeBinding?.kind === "text"
        ? beforeBinding.spans[0]?.textNodeId ?? null
        : null;
    if (beforeNode && !beforeNodeId) {
      fail(
        "UNMAPPED_DOM_CHILD_BOUNDARY",
        "The DOM child boundary is not source-mapped.",
        { runtimeId: binding.runtimeId, offset },
      );
    }
    return {
      kind: "child-boundary",
      parentNodeId: binding.sourceNodeId,
      beforeNodeId,
      affinity,
    };
  }

  sourceAnchorToDomPoint(anchor, options = {}) {
    assertAffinity(anchor?.affinity ?? "right");
    const affinity = anchor?.affinity ?? "right";
    const root = options.root ?? null;
    if (anchor?.kind === "text") {
      const candidates = [];
      for (const { node, binding } of this.records.values()) {
        if (binding.kind !== "text" || !isWithinRoot(node, root)) continue;
        for (const span of binding.spans) {
          if (
            span.textNodeId === anchor.textNodeId
            && anchor.utf16Offset >= span.sourceStartOffset
            && anchor.utf16Offset <= span.sourceEndOffset
          ) {
            candidates.push({
              node,
              offset: span.domStart + anchor.utf16Offset - span.sourceStartOffset,
              atStart: anchor.utf16Offset === span.sourceStartOffset,
              atEnd: anchor.utf16Offset === span.sourceEndOffset,
            });
          }
        }
      }
      const interior = candidates.find((candidate) => !candidate.atStart && !candidate.atEnd);
      const preferred = affinity === "left"
        ? candidates.find((candidate) => candidate.atEnd)
        : candidates.find((candidate) => candidate.atStart);
      const result = interior ?? preferred ?? candidates[0];
      if (!result) {
        fail(
          "SOURCE_ANCHOR_NOT_MAPPED",
          "The source text anchor is not mapped in the current DOM.",
          { textNodeId: anchor.textNodeId, utf16Offset: anchor.utf16Offset },
        );
      }
      return { node: result.node, offset: result.offset };
    }
    if (anchor?.kind !== "child-boundary") {
      fail("INVALID_SOURCE_ANCHOR", "A valid source anchor is required.");
    }
    for (const { node, binding } of this.records.values()) {
      if (
        binding.kind !== "element"
        || binding.sourceNodeId !== anchor.parentNodeId
        || !isWithinRoot(node, root)
      ) continue;
      const children = nodeChildren(node);
      if (anchor.beforeNodeId === null) return { node, offset: children.length };
      const offset = children.findIndex((child) => {
        const childBinding = this.bindings.get(child);
        if (childBinding?.kind === "element") {
          return childBinding.sourceNodeId === anchor.beforeNodeId;
        }
        return childBinding?.kind === "text"
          && childBinding.spans.some((span) => span.textNodeId === anchor.beforeNodeId);
      });
      if (offset >= 0) return { node, offset };
    }
    fail(
      "SOURCE_BOUNDARY_NOT_MAPPED",
      "The source child boundary is not mapped in the current DOM.",
      { parentNodeId: anchor.parentNodeId, beforeNodeId: anchor.beforeNodeId },
    );
  }

  domRangeToSource(root, startNode, startOffset, endNode, endOffset) {
    assertNode(root);
    assertNode(startNode);
    assertNode(endNode);
    const sequence = this.textSequences.get(root);
    if (!sequence) {
      fail("TEXT_SEQUENCE_NOT_BOUND", "The editing root has no bound text sequence.");
    }
    const startId = this.runtimeIdForNode(startNode);
    const endId = this.runtimeIdForNode(endNode);
    const startIndex = sequence.indexOf(startId);
    const endIndex = sequence.indexOf(endId);
    if (startIndex < 0 || endIndex < 0) {
      fail("RANGE_NODE_OUTSIDE_ROOT", "The DOM range is outside the editing root.");
    }
    assertDomOffset(startNode, startOffset);
    assertDomOffset(endNode, endOffset);
    if (startIndex > endIndex || (startIndex === endIndex && startOffset > endOffset)) {
      fail("BACKWARD_DOM_RANGE", "DOM ranges must be supplied in document order.");
    }
    if (startIndex === endIndex && startOffset === endOffset) {
      return {
        collapsed: true,
        segments: [],
        insertAt: this.domPointToSourceAnchor(startNode, startOffset, "right"),
      };
    }

    const segments = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const record = this.records.get(sequence[index]);
      if (!record || record.binding.kind !== "text") {
        fail("STALE_TEXT_SEQUENCE", "The editing root contains a stale text binding.");
      }
      const valueLength = nodeText(record.node).length;
      const localStart = index === startIndex ? startOffset : 0;
      const localEnd = index === endIndex ? endOffset : valueLength;
      if (localEnd <= localStart) continue;
      let covered = 0;
      for (const span of record.binding.spans) {
        const overlapStart = Math.max(localStart, span.domStart);
        const overlapEnd = Math.min(localEnd, span.domEnd);
        if (overlapEnd <= overlapStart) continue;
        covered += overlapEnd - overlapStart;
        segments.push({
          textNodeId: span.textNodeId,
          startOffset: span.sourceStartOffset + overlapStart - span.domStart,
          endOffset: span.sourceStartOffset + overlapEnd - span.domStart,
        });
      }
      if (covered !== localEnd - localStart) {
        fail(
          "UNMAPPED_DOM_RANGE",
          "The DOM range crosses an unmapped text gap.",
          { runtimeId: record.binding.runtimeId, localStart, localEnd },
        );
      }
    }
    if (segments.length === 0) {
      fail("NO_SOURCE_TEXT_IN_DOM_RANGE", "The DOM range contains no source-backed text.");
    }
    return {
      collapsed: false,
      segments: mergeSegments(segments),
      insertAt: this.domPointToSourceAnchor(startNode, startOffset, "right"),
    };
  }
}
