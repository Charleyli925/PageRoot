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
  PROJECT_FILE_SCHEMA_VERSION,
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
  const elements = parsed.elements.flatMap((token) => {
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
      tagName: token.name,
      startOffset: startTag.startOffset,
      endOffset: startTag.endOffset,
      closingDelimiterOffset,
      identityAttributes,
      pagerootId: identityAttributes.length === 1
        ? identityAttributes[0].rawValue
        : null,
    }];
  });

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
    return {
      html: source,
      buffer: Buffer.from(source, "utf8"),
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
  return {
    html: nextHtml,
    buffer: Buffer.from(nextHtml, "utf8"),
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
  if (lostIds.length > 0) {
    throw new ProjectFileRepositoryError(
      "SOURCE_ELEMENT_IDENTITY_LOST",
      "The save would remove persistent identities from existing source elements.",
      { lostIds },
    );
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

export function assertWorkingCopyState(state, loaded, workingCopy) {
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
