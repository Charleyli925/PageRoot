import { realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./lifecycle-core.mjs";
import {
  assertAbsolutePath,
  assertObject,
  loadExecutionPolicy,
  readVerifiedRegularFile,
} from "./agent/policies/execution-policy.mjs";
import { createExecutionHost } from "./agent/hosts/execution-host.mjs";
import {
  acpDriverProfile as genericAcpDriverProfile,
  acpPolicyError,
  acpProcessEnvironment,
  runAcpTask as runGenericAcpTask,
} from "./agent/runtimes/acp-protocol.mjs";
import { runAcpProcessTask } from "./agent/runtimes/acp-process.mjs";
import {
  prepareVerifiedJavaScriptExecution,
  runVerifiedJavaScript,
} from "./agent/runtimes/acp-verified-javascript.mjs";

const LEGACY_COMMON_MESSAGES = Object.freeze({
  RUNTIME_AUTHORITY_DRIFT: "PageRoot no longer authorizes mutations for this ACP Attempt.",
  INPUT_MANIFEST_SHAPE_MISMATCH:
    "The Qoder ACP driver only accepts PageRoot's exact current frozen input manifest shape.",
  OUTPUT_PREEXISTS: "The Qoder ACP driver requires a fresh Attempt output path.",
  COMPLETION_PREEXISTS: "The Qoder ACP driver requires a fresh Attempt completion path.",
  READ_NOT_AUTHORIZED_EXECUTION: "Qoder requested a file outside the frozen read set.",
  WRITE_NOT_AUTHORIZED: "Qoder may only write the exact Candidate output path.",
});

function policyError(code, message, details = {}) {
  const error = acpPolicyError(code, message, details);
  error.name = "QoderAcpPolicyError";
  return error;
}

function legacyCommonMessage(cause) {
  const suffix = String(cause.code || "").replace(/^AGENT_/u, "");
  if (suffix === "READ_NOT_AUTHORIZED") {
    return LEGACY_COMMON_MESSAGES.READ_NOT_AUTHORIZED_EXECUTION;
  }
  const exact = LEGACY_COMMON_MESSAGES[suffix];
  if (exact) return exact;
  return String(cause.message || "")
    .replace(/^Agent execution policy options/u, "ACP task policy options")
    .replaceAll("The Agent", "The ACP")
    .replaceAll("Agent line", "ACP line")
    .replaceAll("Agent limit", "ACP limit")
    .replaceAll("Agent session", "ACP session")
    .replaceAll("Agent read", "ACP read")
    .replaceAll("Agent turn", "ACP turn");
}

function adaptLegacyCommonError(cause) {
  if (!(cause instanceof Error)) return cause;
  if (cause.name === "AgentPolicyError" && /^AGENT_[A-Z0-9_]+$/u.test(cause.code)) {
    const suffix = cause.code.slice("AGENT_".length);
    const message = legacyCommonMessage(cause);
    cause.name = "QoderAcpPolicyError";
    cause.code = `ACP_${suffix}`;
    cause.message = message;
    return cause;
  }
  if (cause instanceof TypeError) {
    cause.message = String(cause.message)
      .replace(/^Agent execution policy options/u, "ACP task policy options")
      .replace(
        /^Restricted execution host requires a verified PageRoot task policy\.$/u,
        "Restricted ACP host requires a verified PageRoot task policy.",
      )
      .replace(
        /^Restricted execution host dependencies are invalid\.$/u,
        "Restricted ACP host dependencies are invalid.",
      )
      .replaceAll("agent/read_text_file path", "fs/read_text_file path")
      .replaceAll("agent/write_text_file path", "fs/write_text_file path");
  }
  return cause;
}

async function loadLegacyPolicy(loader, options) {
  try {
    return await loader(options);
  } catch (cause) {
    throw adaptLegacyCommonError(cause);
  }
}

function adaptLegacyHost(host) {
  return Object.fromEntries(Object.entries(host).map(([name, value]) => {
    if (typeof value !== "function") return [name, value];
    return [name, function legacyHostMethod(...args) {
      try {
        const result = value.apply(host, args);
        return result && typeof result.then === "function"
          ? result.catch((cause) => { throw adaptLegacyCommonError(cause); })
          : result;
      } catch (cause) {
        throw adaptLegacyCommonError(cause);
      }
    }];
  }));
}

export function loadQoderAcpTaskPolicy(options) {
  return loadLegacyPolicy(loadExecutionPolicy, options);
}

export function createRestrictedQoderAcpHost(policy, dependencies) {
  try {
    return adaptLegacyHost(createExecutionHost(policy, dependencies));
  } catch (cause) {
    throw adaptLegacyCommonError(cause);
  }
}

export function qoderAcpEnvironment(overrides = {}, baseEnvironment = process.env) {
  try {
    return acpProcessEnvironment(overrides, baseEnvironment);
  } catch (cause) {
    throw new TypeError(String(cause.message || "").replaceAll("ACP environment", "Qoder environment"));
  }
}

function qoderCreateHost(policy, onEvent) {
  return createRestrictedQoderAcpHost(policy, { onEvent });
}

export function acpDriverProfile(policy) {
  return genericAcpDriverProfile(policy, { createHost: qoderCreateHost });
}

export function runAcpTask(options) {
  return runGenericAcpTask({
    ...options,
    createHost: qoderCreateHost,
  });
}

export async function captureQoderAcpReviewBoundary({
  repository,
  target,
  projectRoot,
}) {
  if (typeof repository?.workspace !== "function") {
    throw new TypeError("A ProjectFileRepository-compatible workspace reader is required.");
  }
  const verifiedTarget = assertObject(target, "Working Copy target");
  const verifiedProjectRoot = await realpath(
    assertAbsolutePath(projectRoot, "projectRoot"),
  );
  const targetProjectRoot = await realpath(
    assertAbsolutePath(verifiedTarget.projectRootPath, "target.projectRootPath"),
  );
  if (verifiedProjectRoot !== targetProjectRoot) {
    throw policyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence root does not match the target Project File.",
    );
  }
  const workspace = await repository.workspace({
    sourcePath: assertAbsolutePath(verifiedTarget.exactSourcePath, "target.exactSourcePath"),
  });
  if (!workspace) {
    throw policyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence workspace could not be loaded.",
    );
  }
  const controlRoot = path.join(verifiedProjectRoot, ".pageroot");
  const manifestFile = await readVerifiedRegularFile(
    path.join(controlRoot, "manifest.json"),
    verifiedProjectRoot,
    "Project manifest evidence",
  );
  const versionSnapshots = [];
  for (const version of workspace.manifest.versions) {
    const snapshot = await readVerifiedRegularFile(
      path.join(controlRoot, version.snapshotRelativePath),
      verifiedProjectRoot,
      "Version snapshot evidence",
    );
    versionSnapshots.push({
      versionId: version.versionId,
      contentSha256: sha256(snapshot.bytes),
    });
  }
  return {
    target: {
      projectId: workspace.target.projectId,
      documentId: workspace.target.documentId,
      workingCopyId: workspace.target.workingCopyId,
      versionId: workspace.target.versionId,
      targetKind: workspace.target.targetKind,
      exactSourcePath: workspace.target.exactSourcePath,
      sourceSha256: workspace.target.sourceSha256,
    },
    manifest: workspace.manifest,
    manifestFileSha256: sha256(manifestFile.bytes),
    workingCopy: workspace.workingCopy,
    workingCopyState: workspace.workingCopyState,
    workingCopies: workspace.workingCopies,
    draft: workspace.draft,
    contentSha256: sha256(Buffer.from(workspace.content, "utf8")),
    versionSnapshots,
  };
}

export function prepareVerifiedQoderJavaScriptExecution(options) {
  return prepareVerifiedJavaScriptExecution(options);
}

export function runVerifiedQoderJavaScript(options) {
  return runVerifiedJavaScript(options);
}

export async function runQoderAcpTask(options) {
  return runAcpProcessTask({
    ...options,
    createHost: qoderCreateHost,
    stderrFieldPrefix: "qoder",
  });
}
