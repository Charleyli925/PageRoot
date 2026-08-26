// Project, Version, Working Copy and Candidate naming without recovering
// ordinals from identifiers.
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  sha256,
} from "../lifecycle-core.mjs";

import {
  HTML_EXTENSIONS,
  IMPORT_STAGING_WRAPPER_BYTES,
  MAX_PATH_COMPONENT_BYTES,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  ensureRelativePath,
  truncateUtf8,
  utf8ByteLength,
} from "./path-safety.mjs";

export function htmlExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!HTML_EXTENSIONS.has(extension)) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_EXTENSION",
      "Only .html and .htm files can be managed.",
    );
  }
  return extension;
}

export function safeProjectName(sourcePath) {
  const extension = htmlExtension(sourcePath);
  const sourceName = path.basename(sourcePath, extension).normalize("NFC").trim();
  const sanitized = sourceName
    .replace(/[\u0000-\u001f<>:"/\\|?*]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/^\.+|\.+$/gu, "")
    .trim();
  return sanitized || "未命名项目";
}

export function assertPreferredFileStem(value, label = "preferredFileStem") {
  const stem = String(value || "").normalize("NFC").trim();
  if (!stem || /[\u0000-\u001f\u007f/\\]/u.test(stem)) {
    throw new ProjectFileRepositoryError(
      "INVALID_FILE_STEM",
      label + " must be a non-empty file-name stem.",
    );
  }
  return stem;
}

export function filenameWithReservedSuffix(stem, suffix, extension, label, extraReservedBytes = 0) {
  const safeStem = assertPreferredFileStem(stem, label);
  const reservedBytes = utf8ByteLength(`${suffix}${extension}`) + extraReservedBytes;
  if (reservedBytes >= MAX_PATH_COMPONENT_BYTES) {
    throw new ProjectFileRepositoryError(
      "PATH_COMPONENT_TOO_LONG",
      `${label} has no remaining space for its required suffix.`,
    );
  }
  const truncated = truncateUtf8(safeStem, MAX_PATH_COMPONENT_BYTES - reservedBytes);
  if (!truncated) {
    throw new ProjectFileRepositoryError(
      "PATH_COMPONENT_TOO_LONG",
      `${label} has no remaining UTF-8 filename space.`,
    );
  }
  return `${truncated}${suffix}${extension}`;
}

// The Version ordinal is read from the manifest, never parsed back out of an
// identifier. `workingCopyId` happens to embed the ordinal today, but that is a
// property of the generator above, not a contract: nothing validates that a
// Working Copy identifier agrees with its Version's ordinal. Recovering the
// ordinal by slicing the identifier would make the identifier a data carrier
// and would have to be undone before identifiers can become globally unique.
export function versionOrdinalFor(manifest, versionIdValue, label = "versionId") {
  const version = manifest?.versions?.find(
    (entry) => entry.versionId === versionIdValue,
  );
  if (!version || !Number.isSafeInteger(version.ordinal)) {
    throw new ProjectFileRepositoryError(
      "INVALID_MANIFEST",
      `The manifest has no Version ordinal for ${label}.`,
      { versionId: versionIdValue },
    );
  }
  return version.ordinal;
}

export function topLevelHtmlRelativePath(value, label = "sourceRelativePath") {
  const relative = ensureRelativePath(value, label);
  if (relative.includes("/")) {
    throw new ProjectFileRepositoryError(
      "INVALID_RELATIVE_PATH",
      label + " must be a top-level HTML file.",
    );
  }
  htmlExtension(relative);
  return relative;
}

export function preferredNamingForWorkingCopyPath(relativePath, ordinal) {
  const relative = topLevelHtmlRelativePath(relativePath);
  const extension = htmlExtension(relative);
  const fileName = path.basename(relative, extension).normalize("NFC");
  const suffix = "-V" + ordinal;
  const stem = fileName.endsWith(suffix) && fileName.length > suffix.length
    ? fileName.slice(0, -suffix.length)
    : fileName;
  return {
    preferredFileStem: assertPreferredFileStem(stem),
    preferredExtension: extension,
  };
}

export function visibleFileName(stem, ordinal, extension, allocationOrdinal = 0) {
  const safeExtension = HTML_EXTENSIONS.has(String(extension || "").toLowerCase())
    ? String(extension).toLowerCase()
    : null;
  if (!safeExtension) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_EXTENSION",
      "Only .html and .htm files can be managed.",
    );
  }
  if (!Number.isSafeInteger(allocationOrdinal) || allocationOrdinal < 0) {
    throw new ProjectFileRepositoryError(
      "INVALID_PATH_ALLOCATION",
      "The Promotion path allocation is invalid.",
    );
  }
  return filenameWithReservedSuffix(
    stem,
    ("-V" + ordinal).repeat(allocationOrdinal + 1),
    safeExtension,
    "Working Copy filename",
  );
}

export function aiTaskCandidateFileName(stem, ordinal, extension) {
  const safeExtension = HTML_EXTENSIONS.has(String(extension || "").toLowerCase())
    ? String(extension).toLowerCase()
    : null;
  if (!safeExtension) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_HTML_EXTENSION",
      "Only .html and .htm files can be used for an AI task Candidate.",
    );
  }
  if (!Number.isSafeInteger(Number(ordinal)) || Number(ordinal) < 2) {
    throw new ProjectFileRepositoryError(
      "INVALID_CANDIDATE",
      "The AI task Candidate Version ordinal is invalid.",
    );
  }
  return filenameWithReservedSuffix(
    stem,
    `-V${Number(ordinal)}-待审阅`,
    safeExtension,
    "AI task Candidate filename",
  );
}

export function projectDirectoryName(stem, ordinal) {
  const suffix = ordinal === 1 ? "" : ` (${ordinal})`;
  // Import first creates a hidden sibling staging directory. Reserve the
  // exact fixed marker (including a UUID) before choosing the eventual
  // project directory name so a valid UTF-8 source name cannot make staging
  // fail after the Registry intent is durable.
  return filenameWithReservedSuffix(
    stem,
    suffix,
    "",
    "project directory name",
    IMPORT_STAGING_WRAPPER_BYTES,
  );
}

export function versionId(ordinal) {
  return `ver_${String(ordinal).padStart(4, "0")}`;
}

export function workingCopyId(ordinal) {
  return `work_ver_${String(ordinal).padStart(4, "0")}`;
}

export function randomId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function candidateIdForRequest(projectId, requestId) {
  return `candidate_${sha256(Buffer.from(`${projectId}:${requestId}`, "utf8"))
    .slice("sha256:".length, "sha256:".length + 32)}`;
}
