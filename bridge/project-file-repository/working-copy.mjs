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
  PROJECT_FILE_SCHEMA_VERSION,
  SAVE_RECOVERY_ID,
  SHA256,
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
