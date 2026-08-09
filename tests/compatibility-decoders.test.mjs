import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decodeVersionAuditChange,
} from "../app/workbench/version-compatibility-decoder.js";
import {
  assessHtmlCandidate,
} from "../scripts/candidate-assessment.mjs";
import {
  decodeCandidateAssessmentRecord,
  decodeHistoricalCandidateAssessment,
} from "../scripts/candidate-assessment-decoder.mjs";
import {
  decodeDraftCommandOperationId,
} from "../scripts/draft-command-decoder.mjs";
import {
  applyDraftCommand,
} from "../scripts/draft-service.mjs";
import {
  decodeDirectEditIdentity,
} from "../shared/direct-edit-compatibility.mjs";
import {
  createDraftOperationId,
  normalizeAuthoritativeDraft,
  operationWasApplied,
} from "../shared/draft-aggregate.mjs";

async function fixture(relativePath) {
  const value = await readFile(
    new URL(`../fixtures/${relativePath}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(value);
}

async function fixtureBuffer(relativePath) {
  return readFile(new URL(`../fixtures/${relativePath}`, import.meta.url));
}

const randomUUID = () => "compatibility_decoder_0001";

test("legacy Draft commands and persisted acknowledgements decode without new legacy ids", async () => {
  const legacyCommand = await fixture(
    "compatibility-decoders/draft-command.missing-operation-id.json",
  );
  const command = applyDraftCommand({
    draftRevision: legacyCommand.expectedDraftRevision,
  }, legacyCommand, { randomUUID });
  assert.match(command.operationId, /^draftop_(?!legacy_)/u);
  assert.equal(command.next.appliedOperationIds[0], command.operationId);
  assert.match(createDraftOperationId(randomUUID), /^draftop_(?!legacy_)/u);
  assert.match(
    decodeDraftCommandOperationId(undefined, { randomUUID }).operationId,
    /^draftop_(?!legacy_)/u,
  );
  assert.throws(
    () => decodeDraftCommandOperationId("not-a-draft-operation", { randomUUID }),
    /operationId/u,
  );

  const persistedDraft = await fixture(
    "compatibility-decoders/draft-authority.current.json",
  );
  const authority = normalizeAuthoritativeDraft(persistedDraft);
  assert.equal(authority.changeEvents.length, 1);
  assert.equal(
    operationWasApplied(authority, "draftop_legacy_000000000001"),
    true,
  );
});

test("direct-edit aliases decode once and reject unknown, ambiguous, and out-of-range input", async () => {
  const legacy = await fixture(
    "compatibility-decoders/version-edit-event.legacy-aliases.json",
  );
  assert.deepEqual(decodeDirectEditIdentity(legacy), {
    basedOnVersionId: "ver_0004",
    revision: 4,
  });
  assert.deepEqual(
    decodeVersionAuditChange(legacy),
    {
      eventId: "edit_legacy_title",
      createdAt: "2026-08-04T07:45:14.371Z",
      kind: "text",
      target: legacy.target,
      before: "旧标题",
      after: "新标题",
      basedOnVersionId: "ver_0004",
      revision: 4,
    },
  );
  const currentArchive = await fixture("v3/annotation-records.frozen.json");
  const current = decodeVersionAuditChange(currentArchive.editEvents[0]);
  assert.equal(current?.basedOnVersionId, "ver_0005");
  assert.equal(current?.revision, 41);
  assert.equal("baseVersionId" in current, false);
  assert.equal("capturedRevision" in current, false);

  assert.throws(
    () => decodeDirectEditIdentity({ ...legacy, unknown: true }),
    (error) => error.code === "UNKNOWN_DIRECT_EDIT_FIELD",
  );
  assert.throws(
    () => decodeDirectEditIdentity({
      ...legacy,
      basedOnVersionId: "ver_0004",
    }),
    (error) => error.code === "DIRECT_EDIT_IDENTITY_AMBIGUOUS",
  );
  assert.throws(
    () => decodeDirectEditIdentity({
      ...legacy,
      baseVersionId: "ver_9007199254740992",
    }),
    (error) => error.code === "DIRECT_EDIT_VERSION_OUT_OF_RANGE",
  );
  assert.equal(decodeVersionAuditChange({ ...legacy, unknown: true }), null);
});

test("Developer Preview candidate-assessment shapes decode to one sealed canonical record", async () => {
  const [current, retired, baseBuffer, outputBuffer] = await Promise.all([
    fixture("candidate-assessment-compat/candidate-assessment.pre-executable-dev.json"),
    fixture("candidate-assessment-compat/candidate-assessment.retired-executable-dev.json"),
    fixtureBuffer("candidate-assessment-compat/base.html"),
    fixtureBuffer("candidate-assessment-compat/output.html"),
  ]);
  const canonicalCurrent = decodeCandidateAssessmentRecord(current);
  const canonicalRetired = decodeCandidateAssessmentRecord(retired);
  assert.deepEqual(canonicalRetired, canonicalCurrent);
  assert.deepEqual(
    decodeHistoricalCandidateAssessment(retired, { baseBuffer, outputBuffer }),
    canonicalCurrent,
  );
  assert.equal("executable" in canonicalCurrent, false);
  assert.equal(
    "executableSurfaceUnchanged" in canonicalCurrent.health,
    false,
  );
  assert.equal(
    "executable" in assessHtmlCandidate({
      baseHtml: baseBuffer.toString("utf8"),
      outputHtml: outputBuffer.toString("utf8"),
    }),
    false,
  );

  assert.throws(
    () => decodeCandidateAssessmentRecord({ ...current, unknown: true }),
    (error) => error.code === "CANDIDATE_ASSESSMENT_INVALID",
  );
  const halfRetired = structuredClone(current);
  halfRetired.health.executableSurfaceUnchanged = true;
  assert.throws(
    () => decodeCandidateAssessmentRecord(halfRetired),
    (error) => error.code === "CANDIDATE_ASSESSMENT_INVALID",
  );
});

test("legacy update manifest remains a release-only compatibility artifact", async () => {
  const manifest = await fixture(
    "compatibility-decoders/legacy-update-manifest.json",
  );
  assert.deepEqual(Object.keys(manifest).sort(), [
    "architectures",
    "minimumMacOS",
    "publishedAt",
    "schemaVersion",
    "version",
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.architectures, ["arm64"]);
});
