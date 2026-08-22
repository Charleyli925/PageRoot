// Discussion Turn runner: the short-lived read-only snapshot lifecycle plus the
// turn outcome model. See docs/AI_CONVERSATION_WORKSPACE_PRD.md §9.2, §9.3 and
// §21.1.
//
// The product rule this module implements: a discussion turn reads the Working
// Copy's current bytes, but the Discussion Host must never receive the Working
// Copy path. So PageRoot copies those bytes into one short-lived read-only
// snapshot under the managed control directory, runs exactly one turn against
// it, and deletes the snapshot when the turn ends — including on failure,
// timeout and cancellation.
//
// This module owns the snapshot and the outcome. It deliberately does not own
// how Qoder is located or spawned: the caller injects `runTurn`, so command,
// executable identity, launch lease and ticket authority stay with the Bridge.
// A discussion turn creates no Request, no Candidate, no Version and no
// finalizer run, and never touches `activeRequest` or runtime state.

import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./lifecycle-core.mjs";
import { loadQoderAcpDiscussionPolicy } from "./qoder-acp-client.mjs";

// PRD §9.3: a discussion turn gets a shorter budget than an execution turn.
export const DISCUSSION_TURN_TIMEOUT_MS = 2 * 60_000;
const SNAPSHOT_DIRECTORY = "discussion-snapshots";
const SNAPSHOT_NAME = "snapshot.html";
const PROMPT_NAME = "PROMPT.md";
const MAX_QUESTION_BYTES = 8 * 1024;
// Matches the shared driver's own retained-update ceiling, so a preserved
// partial turn can never grow without bound.
const MAX_RETAINED_UPDATES = 512;

function discussionError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "DiscussionTurnError";
  error.code = code;
  error.details = details;
  return error;
}

function assertSafeSegment(value, label) {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u.test(value)
    || value.includes("..")
  ) {
    throw discussionError(
      "DISCUSSION_TURN_ID_INVALID",
      `${label} must be one safe path segment.`,
    );
  }
  return value;
}

// The snapshot text is the discussion context, so it must be exactly the bytes
// the caller vouched for. A mismatch means the caller's Working Copy read and
// its Hash disagree, which is a stale-source condition, not a fixable warning.
function verifiedSnapshotBytes(html, expectedSourceSha256) {
  if (typeof html !== "string" || html.length === 0) {
    throw discussionError(
      "DISCUSSION_SNAPSHOT_EMPTY",
      "A discussion turn requires the current Working Copy bytes.",
    );
  }
  const bytes = Buffer.from(html, "utf8");
  const digest = sha256(bytes);
  if (typeof expectedSourceSha256 !== "string" || !expectedSourceSha256) {
    throw discussionError(
      "DISCUSSION_SOURCE_HASH_MISSING",
      "A discussion turn requires the expected Working Copy Hash.",
    );
  }
  if (digest !== expectedSourceSha256) {
    throw discussionError(
      "DISCUSSION_SOURCE_HASH_MISMATCH",
      "The discussion snapshot bytes do not match the expected Working Copy Hash.",
    );
  }
  return { bytes, sourceSha256: digest };
}

function sanitizedQuestion(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw discussionError(
      "DISCUSSION_QUESTION_EMPTY",
      "A discussion turn requires a question.",
    );
  }
  // Keep newlines and tabs; drop the remaining control characters so the
  // prompt cannot smuggle terminal or protocol control sequences.
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim();
  if (!cleaned) {
    throw discussionError(
      "DISCUSSION_QUESTION_EMPTY",
      "A discussion turn requires a question.",
    );
  }
  if (Buffer.byteLength(cleaned, "utf8") > MAX_QUESTION_BYTES) {
    throw discussionError(
      "DISCUSSION_QUESTION_TOO_LARGE",
      "The discussion question exceeds 8 KiB.",
    );
  }
  return cleaned;
}

// The prompt states the read-only boundary in the same words the host enforces.
// It is guidance, never authority: the Discussion Host refuses writes and
// terminals regardless of what the prompt says.
export function discussionPrompt({ question }) {
  const asked = sanitizedQuestion(question);
  return [
    "You are answering a PageRoot discussion turn.",
    "",
    `Read \`${SNAPSHOT_NAME}\` in this directory. It is a read-only snapshot of`,
    "the page the user is currently looking at.",
    "",
    "This turn is discussion only. Do not write any file, do not open a",
    "terminal, and do not produce a replacement page. Answer in prose, quoting",
    "the snapshot where it helps. Any write or terminal request will be refused.",
    "",
    "The user asks:",
    "",
    asked,
    "",
  ].join("\n");
}

async function verifiedControlRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw discussionError(
      "DISCUSSION_PROJECT_ROOT_INVALID",
      "The discussion turn requires an absolute project root.",
    );
  }
  const controlRoot = path.join(path.resolve(projectRoot), ".pageroot");
  const information = await lstat(controlRoot).catch(() => null);
  if (
    !information?.isDirectory()
    || information.isSymbolicLink()
    || (information.mode & 0o022) !== 0
  ) {
    throw discussionError(
      "DISCUSSION_CONTROL_ROOT_INVALID",
      "The managed control directory is missing or unsafe.",
    );
  }
  return realpath(controlRoot);
}

async function createdSnapshotRoot(controlRoot, turnId) {
  const parent = path.join(controlRoot, SNAPSHOT_DIRECTORY);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentInformation = await lstat(parent).catch(() => null);
  if (
    !parentInformation?.isDirectory()
    || parentInformation.isSymbolicLink()
    || (parentInformation.mode & 0o022) !== 0
  ) {
    throw discussionError(
      "DISCUSSION_SNAPSHOT_ROOT_UNSAFE",
      "The discussion snapshot directory is unsafe.",
    );
  }
  const snapshotRoot = path.join(parent, turnId);
  // Not recursive on purpose: a colliding turn directory must fail closed
  // instead of silently reusing or overwriting someone else's snapshot.
  await mkdir(snapshotRoot, { mode: 0o700 }).catch((cause) => {
    throw discussionError(
      "DISCUSSION_SNAPSHOT_EXISTS",
      "A discussion snapshot directory for this turn already exists.",
      { cause: String(cause?.code || cause) },
    );
  });
  return snapshotRoot;
}

// Only ever removes a directory this run created, and only while it still
// resolves inside the managed snapshot directory. PRD §21.1 makes deletion a
// product invariant, so an unconfirmed removal is a failure, not a warning.
async function removeSnapshotRoot(controlRoot, snapshotRoot) {
  const expectedParent = path.join(controlRoot, SNAPSHOT_DIRECTORY);
  const resolved = await realpath(snapshotRoot).catch(() => null);
  if (resolved !== null) {
    const relative = path.relative(expectedParent, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw discussionError(
        "DISCUSSION_SNAPSHOT_CLEANUP_REFUSED",
        "The discussion snapshot left the managed snapshot directory; PageRoot did not delete it.",
      );
    }
  }
  await rm(snapshotRoot, { recursive: true, force: true }).catch(() => {});
  const stillPresent = await access(snapshotRoot, fsConstants.F_OK).then(
    () => true,
    () => false,
  );
  if (stillPresent) {
    throw discussionError(
      "DISCUSSION_SNAPSHOT_CLEANUP_UNCONFIRMED",
      "The discussion snapshot could not be confirmed deleted.",
    );
  }
}

function interruptionReason(cause) {
  if (cause?.code === "ACP_TIMEOUT") return "timeout";
  if (cause?.code === "ACP_CANCELLED" || cause?.code === "ACP_REQUEST_CANCELLED") {
    return "cancelled";
  }
  return null;
}

export async function runDiscussionTurn({
  projectRoot,
  turnId,
  html,
  expectedSourceSha256,
  question,
  runTurn,
  turnTimeoutMs = DISCUSSION_TURN_TIMEOUT_MS,
  cancellationSignal,
  onEvent = () => {},
}) {
  if (typeof runTurn !== "function") {
    throw discussionError(
      "DISCUSSION_RUNNER_MISSING",
      "A discussion turn requires an injected turn runner.",
    );
  }
  if (typeof onEvent !== "function") {
    throw discussionError(
      "DISCUSSION_RUNNER_MISSING",
      "The discussion turn event sink must be a function.",
    );
  }
  const safeTurnId = assertSafeSegment(turnId, "turnId");
  const { bytes, sourceSha256 } = verifiedSnapshotBytes(html, expectedSourceSha256);
  const prompt = discussionPrompt({ question });
  const controlRoot = await verifiedControlRoot(projectRoot);

  // Nothing above this line has written to disk, so a rejected turn leaves no
  // snapshot directory to clean up.
  const snapshotRoot = await createdSnapshotRoot(controlRoot, safeTurnId);
  let outcome;
  let failure = null;
  try {
    await writeFile(path.join(snapshotRoot, SNAPSHOT_NAME), bytes, {
      encoding: null,
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(path.join(snapshotRoot, PROMPT_NAME), prompt, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    const policy = await loadQoderAcpDiscussionPolicy({ snapshotRoot });
    if (policy.sourceSha256 !== sourceSha256) {
      throw discussionError(
        "DISCUSSION_SNAPSHOT_DRIFT",
        "The discussion snapshot changed between writing and freezing it.",
      );
    }

    // The driver only returns its retained updates on a completed turn, so the
    // runner keeps its own bounded copy. That is what lets an interrupted turn
    // report what actually arrived instead of pretending it never started.
    // Scope note: these are the driver's bounded, sanitized update summaries.
    // Passing visible Agent text through is a separate decision (PRD §20 visible
    // text stream) and is not enabled here.
    const retained = [];
    let droppedUpdateCount = 0;
    const collect = (event) => {
      if (event?.kind === "session-update") {
        if (retained.length < MAX_RETAINED_UPDATES) retained.push(event);
        else droppedUpdateCount += 1;
      }
      onEvent(event);
    };

    try {
      const result = await runTurn({
        policy,
        prompt,
        turnTimeoutMs,
        cancellationSignal,
        onEvent: collect,
      });
      outcome = Object.freeze({
        status: "completed",
        interrupted: false,
        interruptedReason: null,
        turnId: safeTurnId,
        sourceSha256,
        stopReason: result?.stopReason ?? null,
        updates: Object.freeze([...(result?.updates ?? retained)]),
        droppedUpdateCount: result?.droppedUpdateCount ?? droppedUpdateCount,
      });
    } catch (cause) {
      const reason = interruptionReason(cause);
      if (!reason) throw cause;
      // PRD §9.3 / §20.2: a timed-out or interrupted discussion keeps what it
      // received and is marked interrupted. It is never presented as complete.
      outcome = Object.freeze({
        status: "interrupted",
        interrupted: true,
        interruptedReason: reason,
        turnId: safeTurnId,
        sourceSha256,
        stopReason: null,
        updates: Object.freeze([...retained]),
        droppedUpdateCount,
      });
    }
  } catch (cause) {
    failure = cause;
  } finally {
    try {
      await removeSnapshotRoot(controlRoot, snapshotRoot);
    } catch (cleanupFailure) {
      // A leftover snapshot breaks a product invariant, so it wins over a
      // successful turn. The outcome rides along so the caller can still show
      // whatever the user already saw.
      if (outcome) cleanupFailure.discussionOutcome = outcome;
      if (failure) cleanupFailure.cause = failure;
      failure = cleanupFailure;
    }
  }
  if (failure) throw failure;
  return outcome;
}
