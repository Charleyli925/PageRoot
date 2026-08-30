import {
  planSemanticStructurePatches,
} from "../../shared/semantic-structure-plan.mjs";

const STRUCTURAL_TYPES = new Set([
  "insertElement",
  "deleteElement",
  "moveElement",
  "replaceSubtree",
]);

function fail(message, details = {}) {
  const error = new Error(message);
  error.name = "SemanticIdentityAuthorizationError";
  error.code = "SEMANTIC_IDENTITY_STRUCTURE_PATCH_MISMATCH";
  error.details = details;
  throw error;
}

function originalForwardEvidence(step, direction) {
  return direction === "undo"
    ? {
        beforeHtml: step.afterHtml,
        patches: step.operation.reversePatches,
      }
    : {
        beforeHtml: step.beforeHtml,
        patches: step.operation.forwardPatches,
      };
}

function structureElements(inspection) {
  return inspection.elements.map((element) => {
    const parent = Number.isInteger(element.parentElementIndex)
      ? inspection.elements[element.parentElementIndex]
      : null;
    return {
      elementId: element.pagerootId,
      tagName: element.tagName,
      parentElementId: parent?.pagerootId ?? null,
      startOffset: element.startOffset,
      endOffset: element.sourceEndOffset,
      contentStartOffset: element.contentStartOffset,
      contentEndOffset: element.contentEndOffset,
      explicitEndTag: element.explicitEndTag,
      isVoid: element.isVoid,
      selfClosing: element.selfClosing,
      boundarySafe: element.boundarySafe,
    };
  });
}

function assertExactPatches(actual, expected) {
  const members = ["startOffset", "endOffset", "before", "after", "kind"];
  if (
    actual.length !== expected.length
    || expected.some((patch, index) => members.some(
      (member) => actual[index]?.[member] !== patch[member],
    ))
  ) {
    fail(
      "The saved structural patches are not the complete kernel semantic plan.",
      {
        expectedPatchCount: expected.length,
        actualPatchCount: actual.length,
      },
    );
  }
}

export function assertKernelStructurePatchMaterialization({
  step,
  beforeIdentity,
  afterIdentity,
  operation,
  direction,
  materializedFragmentHtml = null,
}) {
  if (!STRUCTURAL_TYPES.has(operation.type)) return;
  const forward = originalForwardEvidence(step, direction);
  const forwardBeforeIdentity = direction === "undo"
    ? afterIdentity
    : beforeIdentity;
  let expected;
  try {
    expected = planSemanticStructurePatches({
      source: forward.beforeHtml,
      elements: structureElements(forwardBeforeIdentity),
      operation,
      fragmentHtml: materializedFragmentHtml,
    }).patches;
  } catch (cause) {
    fail(
      "The Repository could not reconstruct the exact kernel structural plan.",
      {
        structurePlanError: cause?.code || "SEMANTIC_STRUCTURE_PLAN_INVALID",
        structurePlanDetails: cause?.details || {},
      },
    );
  }
  assertExactPatches(forward.patches, expected);
}
