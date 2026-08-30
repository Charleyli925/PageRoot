const SEMANTIC_TYPES = new Set([
  "setText",
  "replaceTextRange",
  "setAttribute",
  "setStyle",
  "insertElement",
  "deleteElement",
  "moveElement",
  "replaceSubtree",
]);
const DIRECTIONS = new Set(["forward", "undo", "redo"]);
export const SEMANTIC_OPERATION_SCHEMA_VERSION = 1;

const OPERATION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{7,95}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ELEMENT_ID_PATTERN = /^pr1_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/u;
const COMMON_OPERATION_KEYS = new Set([
  "schemaVersion",
  "operationId",
  "baseRevision",
  "expectedSourceSha256",
  "type",
]);
const OPERATION_FIELDS = new Map([
  ["setText", { required: ["target", "text"], optional: ["contentHtml"] }],
  ["replaceTextRange", { required: ["target", "range", "text"], optional: [] }],
  ["setAttribute", { required: ["target", "name", "value"], optional: [] }],
  ["setStyle", {
    required: ["target", "property", "value", "important"],
    optional: ["range", "createdPagerootIds"],
  }],
  ["insertElement", { required: ["parent", "before", "html"], optional: [] }],
  ["deleteElement", { required: ["target"], optional: [] }],
  ["moveElement", { required: ["target", "parent", "before"], optional: [] }],
  ["replaceSubtree", { required: ["target", "html"], optional: [] }],
]);

export class SemanticIdentityDeltaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SemanticIdentityDeltaError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SemanticIdentityDeltaError(code, message, details);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyMembers(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail("SEMANTIC_OPERATION_MEMBER_UNKNOWN", `${label} contains unsupported members.`, {
      label,
      members: unknown,
    });
  }
}

function assertOperationPrecondition(value, label) {
  if (!record(value)) {
    fail("SEMANTIC_TARGET_PRECONDITION_REQUIRED", `${label} precondition is required.`);
  }
  assertOnlyMembers(
    value,
    new Set(["elementId", "tagName", "expectedOuterHtmlSha256"]),
    label,
  );
  if (!ELEMENT_ID_PATTERN.test(value.elementId ?? "")) {
    fail("SEMANTIC_IDENTITY_ELEMENT_INVALID", `${label}.elementId is not a stable element ID.`);
  }
  if (!/^[a-z][a-z0-9:-]*$/u.test(value.tagName ?? "")) {
    fail("SEMANTIC_TARGET_TAG_INVALID", `${label}.tagName is invalid.`);
  }
  if (!SHA256_PATTERN.test(value.expectedOuterHtmlSha256 ?? "")) {
    fail("SEMANTIC_IDENTITY_HASH_INVALID", `${label}.expectedOuterHtmlSha256 is not a sha256 Hash.`);
  }
}

function assertTextRange(value) {
  if (!record(value)) {
    fail("SEMANTIC_TEXT_RANGE_INVALID", "A semantic text range object is required.");
  }
  assertOnlyMembers(value, new Set(["startOffset", "endOffset", "quote"]), "range");
  if (
    !Number.isSafeInteger(value.startOffset)
    || !Number.isSafeInteger(value.endOffset)
    || value.startOffset < 0
    || value.endOffset < value.startOffset
    || typeof value.quote !== "string"
  ) {
    fail("SEMANTIC_TEXT_RANGE_INVALID", "A semantic text range requires safe ordered offsets and a quote.");
  }
}

/**
 * Validates the public semantic-operation envelope independently of renderer
 * state. Repository calls this before treating an operation as save authority;
 * DOM-specific stale preconditions are verified separately against before HTML.
 */
export function assertSemanticOperationContract(operation) {
  if (!record(operation)) {
    fail("SEMANTIC_OPERATION_INVALID", "A semantic operation object is required.");
  }
  if (operation.schemaVersion !== SEMANTIC_OPERATION_SCHEMA_VERSION) {
    fail("SEMANTIC_OPERATION_SCHEMA_UNSUPPORTED", "Semantic operation schema version is unsupported.", {
      schemaVersion: operation.schemaVersion,
    });
  }
  if (!OPERATION_ID_PATTERN.test(operation.operationId ?? "")) {
    fail("SEMANTIC_OPERATION_ID_INVALID", "Semantic operationId has an invalid format.");
  }
  if (!Number.isSafeInteger(operation.baseRevision) || operation.baseRevision < 0) {
    fail("SEMANTIC_REVISION_INVALID", "baseRevision must be a non-negative safe integer.");
  }
  if (!SHA256_PATTERN.test(operation.expectedSourceSha256 ?? "")) {
    fail("SEMANTIC_OPERATION_HASH_INVALID", "expectedSourceSha256 must be a sha256 Hash.");
  }
  const fields = OPERATION_FIELDS.get(operation.type);
  if (!fields) {
    fail("SEMANTIC_OPERATION_TYPE_UNSUPPORTED", `Unsupported semantic operation type: ${operation.type ?? "missing"}.`);
  }
  assertOnlyMembers(operation, new Set([
    ...COMMON_OPERATION_KEYS,
    ...fields.required,
    ...fields.optional,
  ]), "operation");
  const missing = fields.required.filter((field) => !Object.hasOwn(operation, field));
  if (missing.length > 0) {
    fail("SEMANTIC_OPERATION_MEMBER_REQUIRED", "Semantic operation is missing required members.", {
      members: missing,
    });
  }

  if (fields.required.includes("target")) assertOperationPrecondition(operation.target, "target");
  if (fields.required.includes("parent")) assertOperationPrecondition(operation.parent, "parent");
  if (fields.required.includes("before") && operation.before !== null) {
    assertOperationPrecondition(operation.before, "before");
  }
  if (operation.type === "setText") {
    if (
      typeof operation.text !== "string"
      || (operation.contentHtml !== undefined && typeof operation.contentHtml !== "string")
    ) {
      fail("SEMANTIC_TEXT_INVALID", "setText requires string text and optional string contentHtml.");
    }
  } else if (operation.type === "replaceTextRange") {
    assertTextRange(operation.range);
    if (typeof operation.text !== "string") {
      fail("SEMANTIC_TEXT_INVALID", "replaceTextRange replacement must be a string.");
    }
  } else if (operation.type === "setAttribute") {
    if (
      typeof operation.name !== "string"
      || operation.name.length === 0
      || (operation.value !== null && typeof operation.value !== "string")
    ) {
      fail("SEMANTIC_ATTRIBUTE_INVALID", "setAttribute requires a non-empty name and string-or-null value.");
    }
  } else if (operation.type === "setStyle") {
    if (
      typeof operation.property !== "string"
      || operation.property.length === 0
      || typeof operation.value !== "string"
      || typeof operation.important !== "boolean"
    ) {
      fail("SEMANTIC_STYLE_INVALID", "setStyle requires property/value strings and an explicit important boolean.");
    }
    if (operation.range !== undefined) assertTextRange(operation.range);
    if (operation.createdPagerootIds !== undefined) {
      if (
        !Array.isArray(operation.createdPagerootIds)
        || operation.createdPagerootIds.length === 0
        || new Set(operation.createdPagerootIds).size !== operation.createdPagerootIds.length
        || operation.createdPagerootIds.some((elementId) => !ELEMENT_ID_PATTERN.test(elementId))
      ) {
        fail("SEMANTIC_STYLE_IDENTITY_INVALID", "createdPagerootIds must contain unique stable element IDs.");
      }
    }
  } else if (["insertElement", "replaceSubtree"].includes(operation.type)) {
    if (typeof operation.html !== "string" || operation.html.length === 0) {
      fail("SEMANTIC_FRAGMENT_INVALID", `${operation.type} requires non-empty structural HTML.`);
    }
  }
  return operation;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredElementId(value, label) {
  const elementId = String(value || "");
  if (!ELEMENT_ID_PATTERN.test(elementId)) {
    fail("SEMANTIC_IDENTITY_ELEMENT_INVALID", `${label} is not a stable element ID.`, {
      label,
      elementId,
    });
  }
  return elementId;
}

function requiredSha256(value, label) {
  const hash = String(value || "");
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) {
    fail("SEMANTIC_IDENTITY_HASH_INVALID", `${label} is not a sha256 Hash.`);
  }
  return hash;
}

export function createSemanticIdentitySnapshot({ sourceSha256, elements } = {}) {
  const normalized = [];
  const ids = new Set();
  for (const [sourceOrder, raw] of (Array.isArray(elements) ? elements : []).entries()) {
    const elementId = requiredElementId(raw?.elementId, `elements[${sourceOrder}].elementId`);
    if (ids.has(elementId)) {
      fail("SEMANTIC_IDENTITY_DUPLICATE", "A semantic identity snapshot repeats an element ID.", {
        elementId,
      });
    }
    ids.add(elementId);
    normalized.push({
      elementId,
      tagName: String(raw?.tagName || "").toLowerCase(),
      parentElementId: raw?.parentElementId === null || raw?.parentElementId === undefined
        ? null
        : requiredElementId(raw.parentElementId, `elements[${sourceOrder}].parentElementId`),
      outerHtmlSha256: requiredSha256(
        raw?.outerHtmlSha256,
        `elements[${sourceOrder}].outerHtmlSha256`,
      ),
      sourceOrder,
    });
  }
  if (normalized.some((element) => (
    element.parentElementId !== null && !ids.has(element.parentElementId)
  ))) {
    fail(
      "SEMANTIC_IDENTITY_PARENT_INVALID",
      "A semantic identity snapshot names a parent outside the complete identity set.",
    );
  }
  return Object.freeze({
    sourceSha256: requiredSha256(sourceSha256, "sourceSha256"),
    elements: Object.freeze(normalized.map(Object.freeze)),
  });
}

function facts(snapshot) {
  const byId = new Map(snapshot.elements.map((element) => [element.elementId, element]));
  const children = new Map();
  for (const element of snapshot.elements) {
    const list = children.get(element.parentElementId) ?? [];
    list.push(element.elementId);
    children.set(element.parentElementId, list);
  }
  return { snapshot, byId, children };
}

function arrayEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function setEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function orderedIds(snapshot, ids) {
  return snapshot.elements
    .map((element) => element.elementId)
    .filter((elementId) => ids.has(elementId));
}

function nextSiblingId(snapshotFacts, elementId) {
  const element = snapshotFacts.byId.get(elementId);
  if (!element) return null;
  const siblings = snapshotFacts.children.get(element.parentElementId) ?? [];
  const index = siblings.indexOf(elementId);
  return index >= 0 ? siblings[index + 1] ?? null : null;
}

function placement(snapshotFacts, elementId) {
  const element = snapshotFacts.byId.get(elementId);
  return element
    ? Object.freeze({
        parentElementId: element.parentElementId,
        beforeElementId: nextSiblingId(snapshotFacts, elementId),
      })
    : null;
}

function operationEvidence(operation, direction) {
  return Object.freeze({
    operationId: String(operation?.operationId || ""),
    operationType: String(operation?.type || ""),
    direction,
    targetElementId: operation?.target?.elementId
      ? String(operation.target.elementId)
      : null,
    parentElementId: operation?.parent?.elementId
      ? String(operation.parent.elementId)
      : null,
    beforeElementId: operation?.before?.elementId
      ? String(operation.before.elementId)
      : null,
  });
}

export function deriveSemanticIdentityDelta(
  beforeSnapshot,
  afterSnapshot,
  operation,
  { direction = "forward" } = {},
) {
  if (!DIRECTIONS.has(direction)) {
    fail("SEMANTIC_IDENTITY_DIRECTION_INVALID", "Semantic identity direction is invalid.");
  }
  const before = facts(beforeSnapshot);
  const after = facts(afterSnapshot);
  const beforeIds = new Set(before.byId.keys());
  const afterIds = new Set(after.byId.keys());
  const commonIds = new Set([...beforeIds].filter((elementId) => afterIds.has(elementId)));
  const addedIds = new Set([...afterIds].filter((elementId) => !beforeIds.has(elementId)));
  const removedIds = new Set([...beforeIds].filter((elementId) => !afterIds.has(elementId)));
  const tagChanged = new Set([...commonIds].filter((elementId) => (
    before.byId.get(elementId).tagName !== after.byId.get(elementId).tagName
  )));
  const moved = new Set([...commonIds].filter((elementId) => (
    before.byId.get(elementId).parentElementId
      !== after.byId.get(elementId).parentElementId
  )));
  const targetElementId = operation?.target?.elementId
    ? String(operation.target.elementId)
    : null;
  if (targetElementId && commonIds.has(targetElementId)) {
    const beforePlacement = placement(before, targetElementId);
    const afterPlacement = placement(after, targetElementId);
    if (canonicalJson(beforePlacement) !== canonicalJson(afterPlacement)) {
      moved.add(targetElementId);
    }
  }
  if (String(operation?.type || "") !== "moveElement") {
    for (const parentElementId of new Set([
      ...before.children.keys(),
      ...after.children.keys(),
    ])) {
      const beforeChildren = (before.children.get(parentElementId) ?? [])
        .filter((elementId) => commonIds.has(elementId));
      const afterChildren = (after.children.get(parentElementId) ?? [])
        .filter((elementId) => commonIds.has(elementId));
      if (arrayEqual(beforeChildren, afterChildren)) continue;
      for (const elementId of new Set([...beforeChildren, ...afterChildren])) {
        if (beforeChildren.indexOf(elementId) !== afterChildren.indexOf(elementId)) {
          moved.add(elementId);
        }
      }
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    ...operationEvidence(operation, direction),
    retainedTargetRootElementId: targetElementId && commonIds.has(targetElementId)
      ? targetElementId
      : null,
    addedElementIds: Object.freeze(orderedIds(afterSnapshot, addedIds)),
    removedElementIds: Object.freeze(orderedIds(beforeSnapshot, removedIds)),
    movedElementIds: Object.freeze(orderedIds(afterSnapshot, moved)),
    tagChangedElementIds: Object.freeze(orderedIds(afterSnapshot, tagChanged)),
    targetPlacementBefore: targetElementId ? placement(before, targetElementId) : null,
    targetPlacementAfter: targetElementId ? placement(after, targetElementId) : null,
  });
}

function subtreeIds(snapshotFacts, rootElementId) {
  const result = new Set();
  const pending = [rootElementId];
  while (pending.length > 0) {
    const elementId = pending.shift();
    if (result.has(elementId) || !snapshotFacts.byId.has(elementId)) continue;
    result.add(elementId);
    pending.unshift(...(snapshotFacts.children.get(elementId) ?? []));
  }
  return result;
}

function descendants(snapshotFacts, rootElementId) {
  const result = subtreeIds(snapshotFacts, rootElementId);
  result.delete(rootElementId);
  return result;
}

function assertSubset(actual, allowed, code, message, details = {}) {
  const unexpected = [...actual].filter((value) => !allowed.has(value));
  if (unexpected.length > 0) fail(code, message, { ...details, unexpected });
}

function assertSet(actual, expected, code, message, details = {}) {
  if (!setEqual(actual, expected)) {
    fail(code, message, {
      ...details,
      actual: [...actual],
      expected: [...expected],
    });
  }
}

function assertNoTagChanges(before, after, allowed = new Set()) {
  const changed = [...before.byId.keys()].filter((elementId) => (
    after.byId.has(elementId)
    && before.byId.get(elementId).tagName !== after.byId.get(elementId).tagName
    && !allowed.has(elementId)
  ));
  if (changed.length > 0) {
    fail(
      "SEMANTIC_IDENTITY_TAG_CHANGE_UNAUTHORIZED",
      "The semantic operation changed an unrelated retained element tag.",
      { changed },
    );
  }
}

function assertCommonTopologyEqual(before, after, ignoredIds = new Set()) {
  const common = new Set(
    [...before.byId.keys()].filter((elementId) => after.byId.has(elementId)),
  );
  for (const elementId of common) {
    if (ignoredIds.has(elementId)) continue;
    if (before.byId.get(elementId).parentElementId !== after.byId.get(elementId).parentElementId) {
      fail(
        "SEMANTIC_IDENTITY_PARENT_CHANGE_UNAUTHORIZED",
        "The semantic operation moved an unrelated retained element.",
        { elementId },
      );
    }
  }
  for (const parentElementId of new Set([
    ...before.children.keys(),
    ...after.children.keys(),
  ])) {
    const beforeChildren = (before.children.get(parentElementId) ?? [])
      .filter((elementId) => common.has(elementId) && !ignoredIds.has(elementId));
    const afterChildren = (after.children.get(parentElementId) ?? [])
      .filter((elementId) => common.has(elementId) && !ignoredIds.has(elementId));
    if (!arrayEqual(beforeChildren, afterChildren)) {
      fail(
        "SEMANTIC_IDENTITY_ORDER_CHANGE_UNAUTHORIZED",
        "The semantic operation reordered unrelated retained elements.",
        { parentElementId, beforeChildren, afterChildren },
      );
    }
  }
}

function assertPrecondition(snapshotFacts, evidence, label) {
  if (!evidence || typeof evidence !== "object") {
    fail("SEMANTIC_IDENTITY_PRECONDITION_REQUIRED", `${label} precondition is required.`);
  }
  const elementId = requiredElementId(evidence.elementId, `${label}.elementId`);
  const element = snapshotFacts.byId.get(elementId);
  if (!element) {
    fail("SEMANTIC_IDENTITY_PRECONDITION_MISSING", `${label} is absent from semantic before HTML.`, {
      elementId,
    });
  }
  if (String(evidence.tagName || "").toLowerCase() !== element.tagName) {
    fail("SEMANTIC_IDENTITY_PRECONDITION_TAG", `${label} tag precondition is stale.`, {
      elementId,
    });
  }
  if (String(evidence.expectedOuterHtmlSha256 || "") !== element.outerHtmlSha256) {
    fail("SEMANTIC_IDENTITY_PRECONDITION_HASH", `${label} source precondition is stale.`, {
      elementId,
    });
  }
  return element;
}

function assertPlacement(snapshotFacts, elementId, parentElementId, beforeElementId) {
  const element = snapshotFacts.byId.get(elementId);
  if (
    !element
    || element.parentElementId !== parentElementId
    || nextSiblingId(snapshotFacts, elementId) !== beforeElementId
  ) {
    fail(
      "SEMANTIC_IDENTITY_PLACEMENT_MISMATCH",
      "The semantic result does not match its requested parent and insertion point.",
      { elementId, parentElementId, beforeElementId, actual: placement(snapshotFacts, elementId) },
    );
  }
}

function assertAllowedForwardTransition(beforeSnapshot, afterSnapshot, operation) {
  if (!operation || !SEMANTIC_TYPES.has(String(operation.type || ""))) {
    fail("SEMANTIC_IDENTITY_OPERATION_INVALID", "A public semantic operation is required.");
  }
  if (String(operation.expectedSourceSha256 || "") !== beforeSnapshot.sourceSha256) {
    fail(
      "SEMANTIC_IDENTITY_SOURCE_HASH_MISMATCH",
      "The semantic operation does not begin at the exact saved source Hash.",
    );
  }
  const before = facts(beforeSnapshot);
  const after = facts(afterSnapshot);
  const beforeIds = new Set(before.byId.keys());
  const afterIds = new Set(after.byId.keys());
  const added = new Set([...afterIds].filter((elementId) => !beforeIds.has(elementId)));
  const removed = new Set([...beforeIds].filter((elementId) => !afterIds.has(elementId)));
  const target = [
    "setText",
    "replaceTextRange",
    "setAttribute",
    "setStyle",
    "deleteElement",
    "moveElement",
    "replaceSubtree",
  ].includes(operation.type)
    ? assertPrecondition(before, operation.target, "target")
    : null;
  const parent = ["insertElement", "moveElement"].includes(operation.type)
    ? assertPrecondition(before, operation.parent, "parent")
    : null;
  const beforeSibling = operation.before === null || operation.before === undefined
    ? null
    : assertPrecondition(before, operation.before, "before");
  if (beforeSibling && beforeSibling.parentElementId !== parent.elementId) {
    fail(
      "SEMANTIC_IDENTITY_INSERTION_PRECONDITION",
      "The semantic insertion point is not a child of its declared parent.",
    );
  }

  if (operation.type === "setText") {
    if (!after.byId.has(target.elementId)) {
      fail("SEMANTIC_IDENTITY_TARGET_REMOVED", "setText must retain its target root ID.");
    }
    const beforeDescendants = descendants(before, target.elementId);
    const afterDescendants = descendants(after, target.elementId);
    assertSubset(removed, beforeDescendants, "SEMANTIC_IDENTITY_TEXT_REMOVAL", "setText removed identity outside its target.");
    assertSubset(added, afterDescendants, "SEMANTIC_IDENTITY_TEXT_ADDITION", "setText added identity outside its target.");
    if (operation.contentHtml === undefined) {
      assertSet(removed, beforeDescendants, "SEMANTIC_IDENTITY_TEXT_REMOVAL", "Plain setText must retire all old descendant IDs.");
      assertSet(added, new Set(), "SEMANTIC_IDENTITY_TEXT_ADDITION", "Plain setText cannot add source elements.");
    }
    assertNoTagChanges(before, after);
    assertCommonTopologyEqual(before, after);
    return;
  }

  if (["replaceTextRange", "setAttribute"].includes(operation.type)) {
    assertSet(added, new Set(), "SEMANTIC_IDENTITY_SET_CHANGED", `${operation.type} cannot add element IDs.`);
    assertSet(removed, new Set(), "SEMANTIC_IDENTITY_SET_CHANGED", `${operation.type} cannot remove element IDs.`);
    assertNoTagChanges(before, after);
    assertCommonTopologyEqual(before, after);
    return;
  }

  if (operation.type === "setStyle") {
    const expectedAdded = operation.range
      ? new Set(Array.isArray(operation.createdPagerootIds) ? operation.createdPagerootIds : [])
      : new Set();
    assertSet(removed, new Set(), "SEMANTIC_IDENTITY_STYLE_REMOVAL", "setStyle cannot remove element IDs.");
    assertSet(added, expectedAdded, "SEMANTIC_IDENTITY_STYLE_ADDITION", "Range-style wrapper IDs do not match semantic evidence.");
    assertSubset(added, descendants(after, target.elementId), "SEMANTIC_IDENTITY_STYLE_ADDITION", "Range-style wrapper is outside the target.");
    assertNoTagChanges(before, after);
    assertCommonTopologyEqual(before, after);
    return;
  }

  if (operation.type === "insertElement") {
    assertSet(removed, new Set(), "SEMANTIC_IDENTITY_INSERT_REMOVAL", "insertElement cannot remove existing IDs.");
    assertNoTagChanges(before, after);
    assertCommonTopologyEqual(before, after);
    const roots = [...added].filter((elementId) => !added.has(after.byId.get(elementId)?.parentElementId));
    if (roots.length !== 1 || !setEqual(subtreeIds(after, roots[0]), added)) {
      fail("SEMANTIC_IDENTITY_INSERT_SUBTREE", "insertElement must add exactly one fresh identified subtree.");
    }
    assertPlacement(after, roots[0], parent.elementId, beforeSibling?.elementId ?? null);
    return;
  }

  if (operation.type === "deleteElement") {
    assertSet(added, new Set(), "SEMANTIC_IDENTITY_DELETE_ADDITION", "deleteElement cannot add IDs.");
    assertSet(removed, subtreeIds(before, target.elementId), "SEMANTIC_IDENTITY_DELETE_SUBTREE", "deleteElement must retire exactly its target subtree.");
    assertNoTagChanges(before, after);
    assertCommonTopologyEqual(before, after);
    return;
  }

  if (operation.type === "moveElement") {
    assertSet(added, new Set(), "SEMANTIC_IDENTITY_MOVE_SET", "moveElement cannot add IDs.");
    assertSet(removed, new Set(), "SEMANTIC_IDENTITY_MOVE_SET", "moveElement cannot remove IDs.");
    assertNoTagChanges(before, after);
    assertCommonTopologyEqual(before, after, new Set([target.elementId]));
    assertPlacement(after, target.elementId, parent.elementId, beforeSibling?.elementId ?? null);
    return;
  }

  if (operation.type === "replaceSubtree") {
    if (!after.byId.has(target.elementId)) {
      fail("SEMANTIC_IDENTITY_TARGET_REMOVED", "replaceSubtree must retain its target root ID.");
    }
    assertSet(removed, descendants(before, target.elementId), "SEMANTIC_IDENTITY_REPLACEMENT_REMOVAL", "replaceSubtree must retire every old descendant ID.");
    assertSet(added, descendants(after, target.elementId), "SEMANTIC_IDENTITY_REPLACEMENT_ADDITION", "replaceSubtree must allocate every new descendant ID.");
    assertNoTagChanges(before, after, new Set([target.elementId]));
    assertCommonTopologyEqual(before, after);
  }
}

export function verifySemanticIdentityTransition({
  beforeSnapshot,
  afterSnapshot,
  operation,
  direction = "forward",
  identityDelta,
} = {}) {
  assertSemanticOperationContract(operation);
  if (!DIRECTIONS.has(direction)) {
    fail("SEMANTIC_IDENTITY_DIRECTION_INVALID", "Semantic identity direction is invalid.");
  }
  const actualDelta = deriveSemanticIdentityDelta(
    beforeSnapshot,
    afterSnapshot,
    operation,
    { direction },
  );
  if (canonicalJson(actualDelta) !== canonicalJson(identityDelta)) {
    fail(
      "SEMANTIC_IDENTITY_DELTA_MISMATCH",
      "Declared identityDelta does not match the exact before/after HTML.",
      { actualDelta, identityDelta },
    );
  }
  const forwardBefore = direction === "undo" ? afterSnapshot : beforeSnapshot;
  const forwardAfter = direction === "undo" ? beforeSnapshot : afterSnapshot;
  assertAllowedForwardTransition(forwardBefore, forwardAfter, operation);
  return actualDelta;
}
