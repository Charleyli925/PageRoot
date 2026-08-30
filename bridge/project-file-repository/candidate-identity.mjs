import {
  sha256,
} from "../lifecycle-core.mjs";

import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  inspectSourceElementIdentity,
  materializeSourceElementIdentity,
  sourceElementIdentityBindingSha256,
} from "./working-copy.mjs";

export const CANDIDATE_SOURCE_IDENTITY_REPORT_SCHEMA_VERSION = "1.0.0";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function elementMap(inspection) {
  return new Map(
    inspection.elements
      .filter((element) => element.pagerootId)
      .map((element) => [element.pagerootId, element]),
  );
}

function identitySlots(inspection, retainedIds) {
  const nearestAncestorByIndex = new Map();
  const nearestRetainedAncestorId = (elementIndex) => {
    if (nearestAncestorByIndex.has(elementIndex)) {
      return nearestAncestorByIndex.get(elementIndex);
    }
    const element = inspection.elements[elementIndex];
    const parentIndex = element?.parentElementIndex;
    if (!Number.isInteger(parentIndex)) {
      nearestAncestorByIndex.set(elementIndex, null);
      return null;
    }
    const parent = inspection.elements[parentIndex];
    const result = retainedIds.has(parent?.pagerootId)
      ? parent.pagerootId
      : nearestRetainedAncestorId(parentIndex);
    nearestAncestorByIndex.set(elementIndex, result);
    return result;
  };
  const siblingGroups = new Map();
  inspection.elements.forEach((element, index) => {
    const key = element.parentElementIndex ?? "root";
    const siblings = siblingGroups.get(key) ?? [];
    siblings.push({ element, index });
    siblingGroups.set(key, siblings);
  });
  const slots = new Map();
  for (const siblings of siblingGroups.values()) {
    const previousIds = new Map();
    const nextIds = new Map();
    let retainedId = null;
    for (const sibling of siblings) {
      previousIds.set(sibling.element, retainedId);
      if (retainedIds.has(sibling.element.pagerootId)) {
        retainedId = sibling.element.pagerootId;
      }
    }
    retainedId = null;
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      const sibling = siblings[index];
      nextIds.set(sibling.element, retainedId);
      if (retainedIds.has(sibling.element.pagerootId)) {
        retainedId = sibling.element.pagerootId;
      }
    }
    for (const sibling of siblings) {
      slots.set(sibling.element, JSON.stringify([
        sibling.element.tagName,
        nearestRetainedAncestorId(sibling.index),
        previousIds.get(sibling.element),
        nextIds.get(sibling.element),
      ]));
    }
  }
  return slots;
}

function normalizedElementSource(html, element) {
  let source = String(html).slice(element.startOffset, element.sourceEndOffset);
  if (element.pagerootId) {
    const escaped = element.pagerootId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    source = source.replace(new RegExp(
      `\\s+data-pageroot-id\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped})(?=\\s|/?>)`,
      "iu",
    ), "");
  }
  return source.replace(/\s+/gu, " ").trim();
}

function uniquelyKeyed(elements, keyFor) {
  const values = new Map();
  const ambiguous = new Set();
  for (const element of elements) {
    const key = keyFor(element);
    if (ambiguous.has(key)) continue;
    if (values.has(key)) {
      values.delete(key);
      ambiguous.add(key);
    } else {
      values.set(key, element);
    }
  }
  return values;
}

function groupedByKey(elements, keyFor) {
  const groups = new Map();
  for (const element of elements) {
    const key = keyFor(element);
    const group = groups.get(key) ?? [];
    group.push(element);
    groups.set(key, group);
  }
  return groups;
}

function candidateIdentityError(code, message, issueCodes, details = {}) {
  return new ProjectFileRepositoryError(code, message, {
    ...details,
    issueCodes,
  });
}

export function prepareCandidateSourceIdentity(baseHtml, outputHtml, options = {}) {
  const baseSource = String(baseHtml);
  const submittedSource = String(outputHtml);
  const baseIdentity = inspectSourceElementIdentity(baseSource);
  if (!baseIdentity.complete) {
    throw candidateIdentityError(
      "CANDIDATE_BASE_IDENTITY_INVALID",
      "The frozen Candidate base does not have a complete source identity set.",
      ["CANDIDATE_BASE_IDENTITY_INVALID"],
      { identityIssues: baseIdentity.issues },
    );
  }

  const submittedIdentity = inspectSourceElementIdentity(submittedSource);
  if (!submittedIdentity.valid) {
    throw candidateIdentityError(
      "CANDIDATE_SOURCE_IDENTITY_INVALID",
      "The Candidate contains malformed or duplicated source element identities.",
      submittedIdentity.issues.map((issue) => issue.code),
      { identityIssues: submittedIdentity.issues },
    );
  }

  const baseById = elementMap(baseIdentity);
  const forgedIds = [...submittedIdentity.claimedIds].filter(
    (pagerootId) => !baseIdentity.claimedIds.has(pagerootId),
  );
  if (forgedIds.length > 0) {
    throw candidateIdentityError(
      "CANDIDATE_SOURCE_IDENTITY_FORGED",
      "The Candidate claimed source identities that PageRoot did not allocate.",
      ["CANDIDATE_SOURCE_IDENTITY_FORGED"],
      { forgedIds },
    );
  }

  const retainedIds = new Set(submittedIdentity.claimedIds);
  const deletedIds = [...baseIdentity.claimedIds].filter(
    (pagerootId) => !retainedIds.has(pagerootId),
  );
  if (deletedIds.length > 0 && submittedIdentity.missing.length > 0) {
    const deletedElements = deletedIds.map((pagerootId) => baseById.get(pagerootId));
    const baseSlots = identitySlots(baseIdentity, retainedIds);
    const submittedSlots = identitySlots(submittedIdentity, retainedIds);
    const missingSourceSignatures = uniquelyKeyed(
      submittedIdentity.missing,
      (element) => normalizedElementSource(submittedSource, element),
    );
    const missingSlots = uniquelyKeyed(
      submittedIdentity.missing,
      (element) => submittedSlots.get(element),
    );
    const deletedSourceSignatures = uniquelyKeyed(
      deletedElements,
      (element) => normalizedElementSource(baseSource, element),
    );
    const deletedSlots = uniquelyKeyed(
      deletedElements,
      (element) => baseSlots.get(element),
    );
    const missingSourceGroups = groupedByKey(
      submittedIdentity.missing,
      (element) => normalizedElementSource(submittedSource, element),
    );
    const deletedSourceGroups = groupedByKey(
      deletedElements,
      (element) => normalizedElementSource(baseSource, element),
    );
    const missingSlotGroups = groupedByKey(
      submittedIdentity.missing,
      (element) => submittedSlots.get(element),
    );
    const deletedSlotGroups = groupedByKey(
      deletedElements,
      (element) => baseSlots.get(element),
    );
    const ambiguousExactGroups = [...missingSourceGroups.entries()].flatMap(
      ([sourceSignature, missingGroup]) => {
        const deletedGroup = deletedSourceGroups.get(sourceSignature) ?? [];
        if (
          deletedGroup.length < 2
          || deletedGroup.length !== missingGroup.length
        ) {
          return [];
        }
        return [{
          pagerootIds: deletedGroup.map((element) => element.pagerootId),
          baseTagNames: deletedGroup.map((element) => element.tagName),
          outputTagNames: missingGroup.map((element) => element.tagName),
          baseOccurrenceCount: deletedGroup.length,
          outputOccurrenceCount: missingGroup.length,
          evidence: "exact-source-group",
        }];
      },
    );
    const ambiguousStableSlotGroups = [...missingSlotGroups.entries()].flatMap(
      ([slot, missingGroup]) => {
        const deletedGroup = deletedSlotGroups.get(slot) ?? [];
        if (
          deletedGroup.length < 2
          || deletedGroup.length !== missingGroup.length
        ) {
          return [];
        }
        return [{
          pagerootIds: deletedGroup.map((element) => element.pagerootId),
          baseTagNames: deletedGroup.map((element) => element.tagName),
          outputTagNames: missingGroup.map((element) => element.tagName),
          baseOccurrenceCount: deletedGroup.length,
          outputOccurrenceCount: missingGroup.length,
          evidence: "stable-slot-group",
        }];
      },
    );
    const suspicious = [
      ...ambiguousExactGroups,
      ...ambiguousStableSlotGroups,
      ...submittedIdentity.missing.flatMap((element) => {
      const sourceSignature = normalizedElementSource(submittedSource, element);
      const slot = submittedSlots.get(element);
      const exact = missingSourceSignatures.get(sourceSignature) === element
        ? deletedSourceSignatures.get(sourceSignature)
        : null;
      const sameSlot = missingSlots.get(slot) === element
        ? deletedSlots.get(slot)
        : null;
      const matched = exact ?? sameSlot;
      return matched
        ? [{
            pagerootId: matched.pagerootId,
            baseTagName: matched.tagName,
            outputTagName: element.tagName,
            evidence: exact ? "exact-source" : "stable-slot",
          }]
        : [];
      }),
    ];
    if (suspicious.length > 0) {
      throw candidateIdentityError(
        "CANDIDATE_SOURCE_IDENTITY_LOST",
        "The Candidate omitted an existing identity from a source element that still appears present.",
        ["CANDIDATE_SOURCE_IDENTITY_LOST"],
        { suspicious },
      );
    }
  }

  const materialized = materializeSourceElementIdentity(submittedSource, options);
  const submittedOutputSha256 = sha256(Buffer.from(submittedSource, "utf8"));
  const outputSha256 = sha256(materialized.buffer);
  const identityReport = {
    schemaVersion: CANDIDATE_SOURCE_IDENTITY_REPORT_SCHEMA_VERSION,
    status: "verified",
    baseElementCount: baseIdentity.totalElementCount,
    outputElementCount: materialized.identity.totalElementCount,
    retainedElementCount: retainedIds.size,
    deletedElementCount: deletedIds.length,
    addedElementCount: submittedIdentity.missingElementCount,
    assignedElementCount: materialized.addedElementCount,
    baseIdentityBindingSha256: sourceElementIdentityBindingSha256(baseIdentity),
    outputIdentityBindingSha256: sourceElementIdentityBindingSha256(materialized.identity),
    submittedOutputSha256,
    outputSha256,
    issueCodes: [],
  };
  return {
    html: materialized.html,
    buffer: materialized.buffer,
    identity: materialized.identity,
    identityReport,
    submittedOutputSha256,
    outputSha256,
  };
}

export function assertCandidateSourceIdentityReport(report) {
  if (
    !report
    || report.schemaVersion !== CANDIDATE_SOURCE_IDENTITY_REPORT_SCHEMA_VERSION
    || report.status !== "verified"
    || ![
      "baseElementCount",
      "outputElementCount",
      "retainedElementCount",
      "deletedElementCount",
      "addedElementCount",
      "assignedElementCount",
    ].every((key) => Number.isSafeInteger(report[key]) && report[key] >= 0)
    || report.baseElementCount
      !== report.retainedElementCount + report.deletedElementCount
    || report.outputElementCount
      !== report.retainedElementCount + report.assignedElementCount
    || report.addedElementCount !== report.assignedElementCount
    || !SHA256.test(String(report.baseIdentityBindingSha256 || ""))
    || !SHA256.test(String(report.outputIdentityBindingSha256 || ""))
    || !SHA256.test(String(report.submittedOutputSha256 || ""))
    || !SHA256.test(String(report.outputSha256 || ""))
    || !Array.isArray(report.issueCodes)
    || report.issueCodes.length !== 0
  ) {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_IDENTITY_REPORT_INVALID",
      "Candidate source identity evidence is invalid.",
    );
  }
  return report;
}

export function assertCandidateSourceIdentityOutput(report, outputHtml) {
  const verifiedReport = assertCandidateSourceIdentityReport(report);
  const outputIdentity = inspectSourceElementIdentity(String(outputHtml));
  if (
    !outputIdentity.complete
    || outputIdentity.totalElementCount !== verifiedReport.outputElementCount
    || sourceElementIdentityBindingSha256(outputIdentity)
      !== verifiedReport.outputIdentityBindingSha256
  ) {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_IDENTITY_REPORT_INVALID",
      "Candidate source identity evidence does not match the frozen output HTML.",
      { identityIssues: outputIdentity.issues },
    );
  }
  return outputIdentity;
}
