import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../lifecycle-core.mjs";
import {
  AGENT_POLICY_BRAND,
  MAX_HTML_BYTES,
  MAX_PROMPT_BYTES,
  assertAbsolutePath,
  assertNonEmptyString,
  assertObject,
  policyError,
  readVerifiedRegularFile,
} from "./execution-policy.mjs";

export async function loadDiscussionPolicy(options) {
  const value = assertObject(options, "Agent discussion policy options");
  const allowedOptionNames = new Set(["snapshotRoot", "snapshotName", "promptName"]);
  const unexpectedOption = Object.keys(value).find(
    (name) => !allowedOptionNames.has(name),
  );
  if (unexpectedOption) {
    throw policyError(
      "DISCUSSION_OPTIONS_INVALID",
      `Agent discussion policy options contain unsupported field ${JSON.stringify(unexpectedOption)}.`,
    );
  }
  const { snapshotRoot, snapshotName = "snapshot.html", promptName = "PROMPT.md" } = value;
  const safeName = (name, label) => {
    const text = assertNonEmptyString(name, label);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u.test(text) || text.includes("..")) {
      throw policyError("DISCUSSION_NAME_INVALID", `${label} must be a safe file name.`);
    }
    return text;
  };
  const safeSnapshotName = safeName(snapshotName, "snapshotName");
  const safePromptName = safeName(promptName, "promptName");
  if (safeSnapshotName === safePromptName) {
    throw policyError(
      "DISCUSSION_READ_ORDER_DUPLICATE",
      "The discussion snapshot and prompt must be distinct files.",
    );
  }
  const requestedRoot = assertAbsolutePath(snapshotRoot, "snapshotRoot");
  const rootInformation = await lstat(requestedRoot);
  if (rootInformation.isSymbolicLink() || !rootInformation.isDirectory()) {
    throw policyError(
      "DISCUSSION_UNSAFE_ROOT",
      "The discussion snapshot root must be a real directory.",
    );
  }
  const snapshotRootPath = await realpath(requestedRoot);

  const snapshot = await readVerifiedRegularFile(
    path.join(snapshotRootPath, safeSnapshotName),
    snapshotRootPath,
    "Discussion snapshot",
  );
  if (snapshot.bytes.byteLength > MAX_HTML_BYTES) {
    throw policyError("DISCUSSION_SNAPSHOT_TOO_LARGE", "The discussion snapshot exceeds 20 MiB.");
  }
  const prompt = await readVerifiedRegularFile(
    path.join(snapshotRootPath, safePromptName),
    snapshotRootPath,
    "Discussion prompt",
  );
  if (prompt.bytes.byteLength > MAX_PROMPT_BYTES) {
    throw policyError("DISCUSSION_PROMPT_TOO_LARGE", "The discussion prompt exceeds 256 KiB.");
  }

  return Object.freeze({
    [AGENT_POLICY_BRAND]: true,
    mode: "discussion",
    requestRoot: snapshotRootPath,
    snapshotPath: snapshot.path,
    promptPath: prompt.path,
    sourceSha256: sha256(snapshot.bytes),
    readableFiles: Object.freeze([
      Object.freeze({
        path: snapshot.path,
        role: "discussion-snapshot",
        sha256: sha256(snapshot.bytes),
        byteLength: snapshot.bytes.byteLength,
      }),
      Object.freeze({
        path: prompt.path,
        role: "prompt",
        sha256: sha256(prompt.bytes),
        byteLength: prompt.bytes.byteLength,
      }),
    ]),
  });
}
