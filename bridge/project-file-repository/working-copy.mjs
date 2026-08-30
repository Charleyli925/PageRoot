// Working Copy layout, state validation and same-directory CAS replacement.
import { randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  sha256,
  syncDirectory,
} from "../lifecycle-core.mjs";
import {
  parseHtmlSource,
  rawStartTagAttributes,
} from "../html-source-parser.mjs";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  PAGEROOT_ELEMENT_ID_SCHEMA_VERSION,
  generatePagerootElementId,
  isValidPagerootElementId,
} from "../../shared/pageroot-element-identity.mjs";
import {
  validateSourceHistoryOperationBytes,
} from "../../shared/source-history.mjs";
import {
  createSemanticIdentitySnapshot,
  verifySemanticIdentityTransition,
} from "../../shared/semantic-identity-delta.mjs";

import {
  PROJECT_FILE_SCHEMA_VERSION,
  MAX_HTML_BYTES,
  SAVE_RECOVERY_ID,
  SHA256,
  SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID,
  WORKING_COPY_ID,
  WORKING_COPY_SAVE_STATES,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  topLevelHtmlRelativePath,
} from "./identity.mjs";
import {
  assertId,
  assertRealPathInsideProject,
  decodeHtml,
  ensureRelativePath,
  isObject,
  pathInside,
  resolveRelative,
  validStateTimestamp,
} from "./path-safety.mjs";

const HTML_WHITESPACE = /[\t\n\f\r ]/u;

export const SOURCE_ELEMENT_IDENTITY_MIGRATION_TRANSACTION_SCHEMA_VERSION = "1.0.0";

function startTagClosingDelimiterOffset(source, startTag) {
  let cursor = startTag.endOffset - 1;
  while (cursor > startTag.startOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor -= 1;
  }
  if (source[cursor] !== ">") return null;
  cursor -= 1;
  while (cursor > startTag.startOffset && HTML_WHITESPACE.test(source[cursor])) {
    cursor -= 1;
  }
  return source[cursor] === "/" ? cursor : startTag.endOffset - 1;
}

export function inspectSourceElementIdentity(html) {
  const source = String(html);
  const parsed = parseHtmlSource(source);
  const inspectedElements = parsed.elements.flatMap((token) => {
    const startTag = token.node?.sourceCodeLocation?.startTag;
    if (
      !Number.isInteger(startTag?.startOffset)
      || !Number.isInteger(startTag?.endOffset)
      || startTag.startOffset < 0
      || startTag.endOffset <= startTag.startOffset
      || startTag.endOffset > source.length
    ) {
      return [];
    }
    const closingDelimiterOffset = startTagClosingDelimiterOffset(source, startTag);
    if (!Number.isInteger(closingDelimiterOffset)) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_RANGE_INVALID",
        "A source element start tag cannot be safely identified.",
        { tagName: token.name, startOffset: startTag.startOffset },
      );
    }
    const identityAttributes = rawStartTagAttributes(source, startTag).filter(
      (attribute) => attribute.name === PAGEROOT_ELEMENT_ID_ATTRIBUTE,
    );
    return [{
      node: token.node,
      tagName: token.name,
      startOffset: startTag.startOffset,
      endOffset: startTag.endOffset,
      sourceEndOffset: Number.isInteger(token.node?.sourceCodeLocation?.endOffset)
        ? token.node.sourceCodeLocation.endOffset
        : startTag.endOffset,
      closingDelimiterOffset,
      identityAttributes,
      pagerootId: identityAttributes.length === 1
        ? identityAttributes[0].rawValue
        : null,
    }];
  });
  const elementIndexByNode = new Map(
    inspectedElements.map((element, index) => [element.node, index]),
  );
  const parentElementByNode = new Map();
  const visitAuthoredChildren = (node, authoredParent = null) => {
    for (const child of node?.childNodes ?? []) {
      const explicitElement = elementIndexByNode.has(child);
      if (explicitElement) parentElementByNode.set(child, authoredParent);
      visitAuthoredChildren(child, explicitElement ? child : authoredParent);
    }
    if (node?.content) {
      visitAuthoredChildren(
        node.content,
        elementIndexByNode.has(node) ? node : authoredParent,
      );
    }
  };
  visitAuthoredChildren(parsed.document);
  const elements = inspectedElements.map(({ node, ...element }, sourceOrder) => ({
    ...element,
    sourceOrder,
    parentElementIndex: elementIndexByNode.get(parentElementByNode.get(node)) ?? null,
  }));

  const issues = [];
  const claims = new Map();
  const missing = [];
  for (const element of elements) {
    if (element.identityAttributes.length === 0) {
      missing.push(element);
      continue;
    }
    if (element.identityAttributes.length !== 1) {
      issues.push({
        code: "PAGEROOT_ID_ATTRIBUTE_REPEATED",
        tagName: element.tagName,
        startOffset: element.startOffset,
      });
      continue;
    }
    if (!isValidPagerootElementId(element.pagerootId)) {
      issues.push({
        code: "PAGEROOT_ID_INVALID_FORMAT",
        tagName: element.tagName,
        startOffset: element.startOffset,
        value: element.pagerootId,
      });
      continue;
    }
    const matching = claims.get(element.pagerootId) ?? [];
    matching.push(element);
    claims.set(element.pagerootId, matching);
  }
  for (const [pagerootId, matching] of claims) {
    if (matching.length < 2) continue;
    issues.push({
      code: "PAGEROOT_ID_DUPLICATE_VALUE",
      pagerootId,
      tagNames: matching.map((element) => element.tagName),
      startOffsets: matching.map((element) => element.startOffset),
    });
  }
  return {
    schemaVersion: PAGEROOT_ELEMENT_ID_SCHEMA_VERSION,
    attributeName: PAGEROOT_ELEMENT_ID_ATTRIBUTE,
    valid: issues.length === 0,
    complete: issues.length === 0 && missing.length === 0,
    status: issues.length > 0
      ? "invalid"
      : missing.length === 0
        ? "complete"
        : claims.size === 0
          ? "absent"
          : "partial",
    totalElementCount: elements.length,
    identifiedElementCount: elements.length - missing.length,
    missingElementCount: missing.length,
    elements,
    missing,
    claimedIds: new Set(claims.keys()),
    issues,
    parseErrors: parsed.parseErrors,
  };
}

function identityElementMap(inspection) {
  return new Map(
    inspection.elements
      .filter((element) => isValidPagerootElementId(element.pagerootId))
      .map((element) => [element.pagerootId, element]),
  );
}

export function sourceElementIdentityBindingSha256(htmlOrInspection) {
  const inspection = typeof htmlOrInspection === "string"
    ? inspectSourceElementIdentity(htmlOrInspection)
    : htmlOrInspection;
  if (!inspection?.complete) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_INVALID",
      "A complete source identity set is required to seal its bindings.",
      { issues: inspection?.issues ?? [] },
    );
  }
  const elements = inspection.elements.map((element) => {
    const parent = Number.isInteger(element.parentElementIndex)
      ? inspection.elements[element.parentElementIndex]
      : null;
    return [element.pagerootId, element.tagName, parent?.pagerootId ?? null];
  });
  return sha256(Buffer.from(JSON.stringify({
    schemaVersion: PAGEROOT_ELEMENT_ID_SCHEMA_VERSION,
    elements,
  }), "utf8"));
}

function nearestRetainedAncestorId(inspection, element, retainedIds) {
  let parentIndex = element.parentElementIndex;
  while (Number.isInteger(parentIndex)) {
    const parent = inspection.elements[parentIndex];
    if (!parent) return null;
    if (retainedIds.has(parent.pagerootId)) return parent.pagerootId;
    parentIndex = parent.parentElementIndex;
  }
  return null;
}

function identityBindingIssues(currentIdentity, nextIdentity) {
  const retainedIds = currentIdentity.claimedIds;
  const currentById = identityElementMap(currentIdentity);
  const nextById = identityElementMap(nextIdentity);
  const issues = [];
  for (const pagerootId of retainedIds) {
    const current = currentById.get(pagerootId);
    const next = nextById.get(pagerootId);
    if (!current || !next) continue;
    if (current.tagName !== next.tagName) {
      issues.push({
        code: "PAGEROOT_ID_TAG_CHANGED",
        pagerootId,
        currentTagName: current.tagName,
        nextTagName: next.tagName,
      });
    }
    const currentParentId = nearestRetainedAncestorId(
      currentIdentity,
      current,
      retainedIds,
    );
    const nextParentId = nearestRetainedAncestorId(nextIdentity, next, retainedIds);
    if (currentParentId !== nextParentId) {
      issues.push({
        code: "PAGEROOT_ID_PARENT_CHANGED",
        pagerootId,
        currentParentId,
        nextParentId,
      });
    }
  }
  const currentOrder = currentIdentity.elements.map((element) => element.pagerootId);
  const nextOrder = nextIdentity.elements
    .map((element) => element.pagerootId)
    .filter((pagerootId) => retainedIds.has(pagerootId));
  for (let index = 0; index < currentOrder.length; index += 1) {
    if (currentOrder[index] === nextOrder[index]) continue;
    issues.push({
      code: "PAGEROOT_ID_SOURCE_ORDER_CHANGED",
      sourceOrder: index,
      currentPagerootId: currentOrder[index] ?? null,
      nextPagerootId: nextOrder[index] ?? null,
    });
  }
  return issues;
}

function semanticIdentitySnapshot(html, inspection) {
  return createSemanticIdentitySnapshot({
    sourceSha256: sha256(Buffer.from(html, "utf8")),
    elements: inspection.elements.map((element) => {
      const parent = Number.isInteger(element.parentElementIndex)
        ? inspection.elements[element.parentElementIndex]
        : null;
      return {
        elementId: element.pagerootId,
        tagName: element.tagName,
        parentElementId: parent?.pagerootId ?? null,
        outerHtmlSha256: sha256(Buffer.from(
          html.slice(element.startOffset, element.sourceEndOffset),
          "utf8",
        )),
      };
    }),
  });
}

function identityTransitionFacts(beforeIdentity, afterIdentity) {
  const lostIds = [...beforeIdentity.claimedIds].filter(
    (pagerootId) => !afterIdentity.claimedIds.has(pagerootId),
  );
  const addedIds = [...afterIdentity.claimedIds].filter(
    (pagerootId) => !beforeIdentity.claimedIds.has(pagerootId),
  );
  const bindingIssues = identityBindingIssues(beforeIdentity, afterIdentity);
  return {
    lostIds,
    addedIds,
    bindingIssues,
    changed: lostIds.length > 0 || addedIds.length > 0 || bindingIssues.length > 0,
  };
}

function assertBindingChangesAreAuthorized(currentHtml, nextHtml, sourceHistoryOperations) {
  let steps;
  try {
    steps = validateSourceHistoryOperationBytes(
      sourceHistoryOperations,
      currentHtml,
      nextHtml,
      (value) => sha256(Buffer.from(value, "utf8")),
    );
  } catch (cause) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save's source operation evidence does not reproduce its HTML.",
      { sourceHistoryError: cause?.code || "SOURCE_HISTORY_INVALID" },
    );
  }
  for (const step of steps) {
    const beforeIdentity = inspectSourceElementIdentity(step.beforeHtml);
    const afterIdentity = inspectSourceElementIdentity(step.afterHtml);
    if (!beforeIdentity.complete || !afterIdentity.complete) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "A source operation would create an incomplete identity set.",
        {
          operationId: step.operation.operationId,
          beforeStatus: beforeIdentity.status,
          afterStatus: afterIdentity.status,
        },
      );
    }
    const transition = identityTransitionFacts(beforeIdentity, afterIdentity);
    const semanticOperation = step.operation.semanticOperation;
    const identityDelta = step.operation.identityDelta;
    const semanticDirection = String(step.operation.semanticDirection || "");
    if (!semanticOperation || !identityDelta || !["forward", "undo", "redo"].includes(semanticDirection)) {
      if (!transition.changed) continue;
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "The save changes persistent identity without semantic operation evidence.",
        { operationId: step.operation.operationId, ...transition },
      );
    }
    try {
      verifySemanticIdentityTransition({
        beforeSnapshot: semanticIdentitySnapshot(step.beforeHtml, beforeIdentity),
        afterSnapshot: semanticIdentitySnapshot(step.afterHtml, afterIdentity),
        operation: semanticOperation,
        direction: semanticDirection,
        identityDelta,
      });
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "Semantic operation evidence does not authorize the exact identity transition.",
        {
          operationId: step.operation.operationId,
          semanticIdentityError: cause?.code || "SEMANTIC_IDENTITY_INVALID",
          semanticIdentityDetails: cause?.details || {},
          ...transition,
        },
      );
    }
  }
}

function assertMaterializedHtmlWithinLimit(buffer) {
  if (buffer.byteLength > MAX_HTML_BYTES) {
    throw new ProjectFileRepositoryError(
      "SOURCE_TOO_LARGE",
      "The identity-materialized Working Copy is too large.",
      {
        byteLength: buffer.byteLength,
        maxByteLength: MAX_HTML_BYTES,
      },
    );
  }
  return buffer;
}

export function materializeSourceElementIdentity(html, {
  randomUUIDFactory = randomUUID,
} = {}) {
  const source = String(html);
  const inspection = inspectSourceElementIdentity(source);
  if (!inspection.valid) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_INVALID",
      "The Working Copy contains malformed or duplicated PageRoot element identities.",
      { issues: inspection.issues },
    );
  }
  if (inspection.complete) {
    const buffer = assertMaterializedHtmlWithinLimit(Buffer.from(source, "utf8"));
    return {
      html: source,
      buffer,
      changed: false,
      addedElementCount: 0,
      identity: inspection,
    };
  }

  const allocated = new Set(inspection.claimedIds);
  const insertions = inspection.missing.map((element) => {
    let pagerootId = null;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = generatePagerootElementId(randomUUIDFactory);
      if (!allocated.has(candidate)) {
        pagerootId = candidate;
        allocated.add(candidate);
        break;
      }
    }
    if (!pagerootId) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_ALLOCATION_FAILED",
        "A unique PageRoot element identity could not be allocated.",
      );
    }
    return {
      offset: element.closingDelimiterOffset,
      value: ` ${PAGEROOT_ELEMENT_ID_ATTRIBUTE}="${pagerootId}"`,
    };
  }).sort((left, right) => right.offset - left.offset);

  let nextHtml = source;
  for (const insertion of insertions) {
    nextHtml = nextHtml.slice(0, insertion.offset)
      + insertion.value
      + nextHtml.slice(insertion.offset);
  }
  const nextIdentity = inspectSourceElementIdentity(nextHtml);
  if (!nextIdentity.complete) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_MATERIALIZATION_FAILED",
      "The materialized Working Copy does not have a complete identity set.",
      { issues: nextIdentity.issues },
    );
  }
  const buffer = assertMaterializedHtmlWithinLimit(Buffer.from(nextHtml, "utf8"));
  return {
    html: nextHtml,
    buffer,
    changed: true,
    addedElementCount: insertions.length,
    identity: nextIdentity,
  };
}

export function materializeIdentityPreservingSave(currentHtml, nextHtml, options = {}) {
  const currentIdentity = inspectSourceElementIdentity(currentHtml);
  if (!currentIdentity.complete) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The current Working Copy lost or corrupted its persistent source element identities.",
      { issues: currentIdentity.issues },
    );
  }
  const nextIdentity = inspectSourceElementIdentity(nextHtml);
  if (!nextIdentity.valid) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save would corrupt persistent source element identities.",
      { issues: nextIdentity.issues },
    );
  }
  const lostIds = [...currentIdentity.claimedIds].filter(
    (pagerootId) => !nextIdentity.claimedIds.has(pagerootId),
  );
  const addedIds = [...nextIdentity.claimedIds].filter(
    (pagerootId) => !currentIdentity.claimedIds.has(pagerootId),
  );
  if (nextIdentity.missingElementCount > 0) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save would publish source elements without persistent identity.",
      {
        lostIds,
        missingElementCount: nextIdentity.missingElementCount,
        missingElements: nextIdentity.missing.map((element) => ({
          tagName: element.tagName,
          startOffset: element.startOffset,
        })),
      },
    );
  }
  const bindingIssues = identityBindingIssues(currentIdentity, nextIdentity);
  const sourceHistoryOperations = Array.isArray(options.sourceHistoryOperations)
    ? options.sourceHistoryOperations
    : [];
  if (
    lostIds.length > 0
    || bindingIssues.length > 0
    || addedIds.length > 0
    || sourceHistoryOperations.length > 0
  ) {
    if (sourceHistoryOperations.length === 0) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_LOST",
        "The save would change persistent identity bindings without source operation evidence.",
        { lostIds, addedIds, bindingIssues },
      );
    }
    assertBindingChangesAreAuthorized(currentHtml, nextHtml, sourceHistoryOperations);
  }
  return materializeSourceElementIdentity(nextHtml, options);
}

export function sourceElementIdentityMigrationRecoveryPaths(
  paths,
  workingCopyIdValue,
  identitySchemaVersion,
  recoveryId,
) {
  const workingCopy = assertId(workingCopyIdValue, WORKING_COPY_ID, "workingCopyId");
  if (identitySchemaVersion !== PAGEROOT_ELEMENT_ID_SCHEMA_VERSION) {
    throw new ProjectFileRepositoryError(
      "IDENTITY_MIGRATION_INVALID",
      "The source element identity migration schema is unsupported.",
    );
  }
  const id = String(recoveryId || "");
  const prefix = `identity_${workingCopy}_v${identitySchemaVersion}_`;
  if (
    !SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID.test(id)
    || !id.startsWith(prefix)
  ) {
    throw new ProjectFileRepositoryError(
      "IDENTITY_MIGRATION_INVALID",
      "The source element identity recovery location is invalid.",
    );
  }
  const operationRoot = path.join(paths.recoveryRoot, id);
  if (!pathInside(paths.recoveryRoot, operationRoot)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "The source element identity recovery location escapes recovery/.",
    );
  }
  return {
    operationRoot,
    previousPath: path.join(operationRoot, "previous.html"),
    nextPath: path.join(operationRoot, "next.html"),
  };
}

export function saveRecoveryPaths(paths, workingCopyIdValue, revision, recoveryId) {
  const normalizedRevision = Number.isSafeInteger(Number(revision)) && Number(revision) >= 0
    ? Number(revision)
    : 0;
  const id = String(recoveryId || "");
  const prefix = `save_${assertId(workingCopyIdValue, WORKING_COPY_ID, "workingCopyId")}_${normalizedRevision || "current"}_`;
  if (!SAVE_RECOVERY_ID.test(id) || !id.startsWith(prefix)) {
    throw new ProjectFileRepositoryError(
      "SAVE_TRANSACTION_INVALID",
      "The Working Copy save recovery location is invalid.",
    );
  }
  const operationRoot = path.join(paths.recoveryRoot, id);
  if (!pathInside(paths.recoveryRoot, operationRoot)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "The Working Copy save recovery location escapes recovery/.",
    );
  }
  return {
    operationRoot,
    previousPath: path.join(operationRoot, "previous.html"),
    nextPath: path.join(operationRoot, "next.html"),
  };
}

export async function compareAndSwapWorkingCopyFile({
  sourcePath,
  nextBuffer,
  expectedSha256,
  nextSha256,
  projectRootPath,
}) {
  const parent = path.dirname(sourcePath);
  await assertRealPathInsideProject(projectRootPath, parent, "Working Copy parent", {
    expectedKind: "directory",
  });
  const temporary = path.join(
    parent,
    `.pageroot-save-${process.pid}-${randomUUID()}.tmp`,
  );
  await atomicWriteFile(temporary, nextBuffer);
  let swapped = false;
  try {
    let currentBuffer;
    try {
      const information = await lstat(sourcePath);
      if (information.isSymbolicLink() || !information.isFile()) {
        throw new ProjectFileRepositoryError(
          "UNSAFE_FILE",
          "Working Copy must be a regular file, not a symbolic link.",
        );
      }
      currentBuffer = await readFile(sourcePath);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        return { swapped: false, actualSha256: null, written: null };
      }
      throw cause;
    }
    const actualSha256 = sha256(currentBuffer);
    if (actualSha256 !== expectedSha256) {
      return { swapped: false, actualSha256, written: null };
    }
    await rename(temporary, sourcePath);
    swapped = true;
    await syncDirectory(parent);
  } finally {
    if (!swapped) await rm(temporary, { force: true }).catch(() => {});
  }

  const writtenBuffer = await readFile(sourcePath);
  const writtenSha256 = sha256(writtenBuffer);
  if (writtenSha256 !== nextSha256) {
    throw new ProjectFileRepositoryError(
      "SOURCE_HASH_CONFLICT",
      "The Working Copy changed while PageRoot was verifying its save.",
      { expectedSourceSha256: nextSha256, actualSourceSha256: writtenSha256 },
    );
  }
  const information = await lstat(sourcePath);
  return {
    swapped: true,
    actualSha256: writtenSha256,
    written: {
      buffer: writtenBuffer,
      html: decodeHtml(writtenBuffer, "Working Copy"),
      sha256: writtenSha256,
      information,
    },
  };
}

export function workingCopyStatePath(paths, workingCopy) {
  const relative = ensureRelativePath(workingCopy.stateRelativePath, "stateRelativePath");
  const resolved = resolveRelative(paths.controlRoot, relative, "stateRelativePath");
  if (!pathInside(paths.workingCopiesRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Working Copy state must stay inside working-copies/.",
    );
  }
  return resolved;
}

export function draftRelativePathFor(workingCopy) {
  return `drafts/${workingCopy.workingCopyId}.json`;
}

export function assertWorkingCopyState(
  state,
  loaded,
  workingCopy,
  { allowMissingIdentityBinding = false } = {},
) {
  const expectedDraftRelativePath = draftRelativePathFor(workingCopy);
  const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
  const basedOnVersion = loaded.manifest.versions.find(
    (version) => version.versionId === workingCopy.basedOnVersionId,
  );
  if (
    !isObject(state)
    || state.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || state.projectId !== loaded.project.projectId
    || state.documentId !== loaded.project.documentId
    || state.workingCopyId !== workingCopy.workingCopyId
    || state.basedOnVersionId !== workingCopy.basedOnVersionId
    || !basedOnVersion
    || !SHA256.test(String(state.baseSha256 || ""))
    || state.baseSha256 !== basedOnVersion.contentSha256
    || !SHA256.test(String(state.currentSha256 || ""))
    || typeof state.differsFromBase !== "boolean"
    || state.differsFromBase !== (state.currentSha256 !== state.baseSha256)
    || state.draftId !== `draft_${workingCopy.workingCopyId}`
    || state.draftRelativePath !== expectedDraftRelativePath
    || (state.draftSha256 !== null && !SHA256.test(String(state.draftSha256 || "")))
    || !validRevision(state.draftRevision)
    || !WORKING_COPY_SAVE_STATES.has(state.saveState)
    || !validRevision(state.lastPersistedRevision)
    || !validStateTimestamp(state.lastSavedAt)
    || !validStateTimestamp(state.lastOpenedAt)
    || (
      state.sourceElementIdentitySchemaVersion !== undefined
      && state.sourceElementIdentitySchemaVersion !== PAGEROOT_ELEMENT_ID_SCHEMA_VERSION
    )
    || (
      state.sourceElementIdentitySchemaVersion === PAGEROOT_ELEMENT_ID_SCHEMA_VERSION
      && (
        !allowMissingIdentityBinding
        || state.sourceElementIdentityBindingSha256 !== undefined
      )
      && !SHA256.test(String(state.sourceElementIdentityBindingSha256 || ""))
    )
    || (
      state.sourceElementIdentitySchemaVersion === undefined
      && state.sourceElementIdentityBindingSha256 !== undefined
    )
  ) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_STATE_INVALID",
      "The Working Copy state does not match its immutable project authority.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  return state;
}

export function workingCopySourcePath(paths, workingCopy) {
  const relative = topLevelHtmlRelativePath(
    workingCopy.sourceRelativePath,
    "sourceRelativePath",
  );
  const resolved = resolveRelative(paths.projectRootPath, relative, "sourceRelativePath");
  if (pathInside(paths.controlRoot, resolved, { allowRoot: true })) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "A visible Working Copy cannot be inside .pageroot.",
    );
  }
  return resolved;
}

export function publicOpenTarget({
  project,
  projectRootPath,
  targetKind,
  workingCopy = null,
  version = null,
  exactSourcePath,
  sourceSha256,
}) {
  return Object.freeze({
    projectId: project.projectId,
    documentId: project.documentId,
    projectRootPath,
    targetKind,
    workingCopyId: workingCopy?.workingCopyId || null,
    versionId: version?.versionId || workingCopy?.versionId || null,
    exactSourcePath,
    sourceSha256,
  });
}
