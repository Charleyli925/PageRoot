/**
 * Stable policy for resolving mutation commands against an already-registered
 * PageRoot project. Filesystem and registry I/O remain in workspace-bridge;
 * this module owns the identity invariants shared by every mutation route.
 */

export class ProjectContextPolicyError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ProjectContextPolicyError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function identityText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Registered mutations must carry the complete identity captured when the
 * command was queued. Legacy callers that omit both IDs may still resolve an
 * existing project by path, but they never gain project-creation authority.
 */
export function registeredCommandIdentity(body) {
  const projectId = identityText(body?.projectId);
  const documentId = identityText(body?.documentId);
  if (!projectId && !documentId) return null;
  if (!projectId || !documentId) {
    throw new ProjectContextPolicyError(
      400,
      "INCOMPLETE_PROJECT_CONTEXT",
      "Registered mutations require both projectId and documentId.",
    );
  }
  return Object.freeze({ projectId, documentId });
}

/**
 * Validate the ID graph without consulting the mutable source-path index. A
 * PageRoot atomic replacement can temporarily make that path index stale, but
 * it cannot change the command's registered project/document identity.
 */
export function registeredProjectRecord(registry, identity) {
  const project = registry?.projects?.[identity.projectId] ?? null;
  if (!project) {
    throw new ProjectContextPolicyError(
      404,
      "REGISTERED_PROJECT_NOT_FOUND",
      "The registered project is no longer available.",
    );
  }
  if (
    identityText(project.documentId)
    && identityText(project.documentId) !== identity.documentId
  ) {
    throw new ProjectContextPolicyError(
      409,
      "PROJECT_CONTEXT_MISMATCH",
      "The registered project and document identities do not match.",
    );
  }
  const document = registry?.documents?.[identity.documentId] ?? null;
  if (
    !document
    || identityText(document.projectId) !== identity.projectId
  ) {
    throw new ProjectContextPolicyError(
      409,
      "PROJECT_CONTEXT_MISMATCH",
      "The registered project and document identities do not match.",
    );
  }
  return Object.freeze({ project, document });
}

/**
 * Classify a changed inode observed at the registered source path. The
 * pending-write outbox is the durable proof that a target hash was produced by
 * PageRoot before project.json and the registry sidecar reached their commit
 * points.
 */
export function classifySourceObservation({
  sourceSha256,
  embeddedDocumentId,
  registeredDocumentId,
  projectCurrentHtmlSha256,
  pendingTargetHtmlSha256,
}) {
  if (
    sourceSha256
    && sourceSha256 === projectCurrentHtmlSha256
  ) return "registered-current";
  if (
    sourceSha256
    && sourceSha256 === pendingTargetHtmlSha256
  ) return "pageroot-pending-write";
  if (
    embeddedDocumentId
    && embeddedDocumentId === registeredDocumentId
  ) return "legacy-stamped-document";
  return "external-replacement";
}
