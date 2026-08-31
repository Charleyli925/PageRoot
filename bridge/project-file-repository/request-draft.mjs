// Request/Attempt layout, frozen AI rules and Draft record validation.
import path from "node:path";

import {
  sha256,
} from "../lifecycle-core.mjs";

import {
  PROJECT_FILE_SCHEMA_VERSION,
  SAFE_REQUEST_ID,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  draftRelativePathFor,
} from "./working-copy.mjs";
import {
  isObject,
  pathInside,
  resolveRelative,
} from "./path-safety.mjs";

export const FROZEN_REQUEST_RULES = `# PageRoot AI Request Rules

- Read the frozen files in input-manifest.json readOrder before editing.
- Treat the frozen HTML, project rules, annotations, comment attachments and change request as read-only.
- For every instruction, follow its attachmentRefs into requirements.attachments and read the matching attachment's requestRelativePath under the Request root. Never read a Draft attachment or an external original path.
- Preserve content outside the explicitly frozen targets.
- Write exactly one complete HTML document to the output path stated in PROMPT.md.
- A valid output remains a Candidate until the user explicitly adopts it.
`;

export const REQUEST_FREEZE_RECOVERY_SCHEMA_VERSION = "1.0.0";

export function requestInputFileRecord(relativePath, role, mediaType, buffer) {
  return {
    path: String(relativePath).split(path.sep).join("/"),
    role,
    mediaType,
    byteLength: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

export function assertWorkingCopyDraft(draft, draftSha256, state, loaded, workingCopy) {
  const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    !isObject(draft)
    || draft.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || draft.projectId !== loaded.project.projectId
    || draft.documentId !== loaded.project.documentId
    || draft.workingCopyId !== workingCopy.workingCopyId
    || draft.basedOnVersionId !== workingCopy.basedOnVersionId
    || !validRevision(draft.draftRevision)
    || draft.draftRevision !== state.draftRevision
    || !Array.isArray(draft.comments)
    || !Array.isArray(draft.changeEvents)
    || !Array.isArray(draft.deletedCommentIds)
    || !Array.isArray(draft.appliedOperationIds)
    || state.draftSha256 === null
    || state.draftSha256 !== draftSha256
  ) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_DRAFT_INVALID",
      "The Working Copy Draft does not match its durable state.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  return draft;
}

export function draftPathForState(paths, workingCopy, state) {
  const relative = state?.draftRelativePath;
  if (relative !== draftRelativePathFor(workingCopy)) {
    throw new ProjectFileRepositoryError(
      "WORKING_COPY_STATE_INVALID",
      "The Working Copy state points to an unexpected Draft location.",
      { workingCopyId: workingCopy.workingCopyId },
    );
  }
  const resolved = resolveRelative(paths.controlRoot, relative, "draftRelativePath");
  if (!pathInside(paths.draftsRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Working Copy draft must stay inside drafts/.",
    );
  }
  return resolved;
}

export function requestRootPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  return path.join(paths.requestsRoot, id);
}

export function requestFreezeStagingRootPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  const root = path.join(paths.recoveryRoot, "request-freeze");
  const staging = path.join(root, id);
  if (!pathInside(paths.recoveryRoot, staging)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Request freeze staging must stay inside recovery/.",
    );
  }
  return staging;
}

export function requestFreezeMarkerPath(paths, requestId) {
  const id = String(requestId || "");
  if (!SAFE_REQUEST_ID.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
  }
  const marker = path.join(
    paths.recoveryRoot,
    "request-freeze",
    `${id}.json`,
  );
  if (!pathInside(paths.recoveryRoot, marker)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "Request freeze recovery marker must stay inside recovery/.",
    );
  }
  return marker;
}

export function cancellationAuthorityPath(paths, requestId, attemptId) {
  const request = String(requestId || "");
  const attempt = String(attemptId || "");
  if (!SAFE_REQUEST_ID.test(request) || !SAFE_REQUEST_ID.test(attempt)) {
    throw new ProjectFileRepositoryError(
      "INVALID_REQUEST_ID",
      "The cancellation authority identity is invalid.",
    );
  }
  return path.join(paths.recoveryRoot, "cancellations", `${request}.${attempt}.json`);
}
