import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateSourceIdentityOutput,
  assertCandidateSourceIdentityReport,
  prepareCandidateSourceIdentity,
} from "../bridge/project-file-repository/candidate-identity.mjs";
import {
  inspectSourceElementIdentity,
} from "../bridge/project-file-repository/working-copy.mjs";

const IDS = {
  html: "pr1_11111111111141118111111111111111",
  head: "pr1_22222222222242229222222222222222",
  title: "pr1_3333333333334333a333333333333333",
  body: "pr1_4444444444444444b444444444444444",
  main: "pr1_55555555555545558555555555555555",
  section: "pr1_66666666666646669666666666666666",
  first: "pr1_7777777777774777a777777777777777",
  second: "pr1_8888888888884888b888888888888888",
};

function attribute(id) {
  return `data-pageroot-id="${id}"`;
}

function baseHtml() {
  return `<!doctype html><html ${attribute(IDS.html)}><head ${attribute(IDS.head)}><title ${attribute(IDS.title)}>报告</title></head><body ${attribute(IDS.body)}><main ${attribute(IDS.main)}><section ${attribute(IDS.section)}><p ${attribute(IDS.first)}>甲</p><p ${attribute(IDS.second)}>乙</p></section></main></body></html>`;
}

test("Candidate identity keeps retained IDs, allows delete and move, and assigns only new elements", () => {
  const output = `<!doctype html><html ${attribute(IDS.html)}><head ${attribute(IDS.head)}><title ${attribute(IDS.title)}>新报告</title></head><body ${attribute(IDS.body)}><main ${attribute(IDS.main)}><section ${attribute(IDS.section)}><p ${attribute(IDS.second)}>乙已更新</p><article>新增结论</article></section></main></body></html>`;
  const prepared = prepareCandidateSourceIdentity(baseHtml(), output, {
    randomUUIDFactory: () => "99999999-9999-4999-8999-999999999999",
  });
  const identity = inspectSourceElementIdentity(prepared.html);

  assert.equal(identity.complete, true);
  assert.equal(identity.claimedIds.has(IDS.first), false);
  assert.equal(identity.claimedIds.has(IDS.second), true);
  assert.equal(identity.claimedIds.has("pr1_99999999999949998999999999999999"), true);
  assert.equal(prepared.identityReport.retainedElementCount, 7);
  assert.equal(prepared.identityReport.deletedElementCount, 1);
  assert.equal(prepared.identityReport.addedElementCount, 1);
  assert.equal(prepared.identityReport.assignedElementCount, 1);
  assert.equal(prepared.identityReport.outputElementCount, 8);
  assert.equal(prepared.identityReport.submittedOutputSha256, prepared.submittedOutputSha256);
  assert.equal(prepared.identityReport.outputSha256, prepared.outputSha256);
  assertCandidateSourceIdentityReport(prepared.identityReport);
  assertCandidateSourceIdentityOutput(prepared.identityReport, prepared.html);
});

test("Candidate identity rejects duplicate and forged IDs", () => {
  const duplicate = baseHtml().replace(IDS.second, IDS.first);
  assert.throws(
    () => prepareCandidateSourceIdentity(baseHtml(), duplicate),
    (error) => error?.code === "CANDIDATE_SOURCE_IDENTITY_INVALID"
      && error.details.issueCodes.includes("PAGEROOT_ID_DUPLICATE_VALUE"),
  );

  const forged = baseHtml().replace(
    IDS.second,
    "pr1_99999999999949998999999999999999",
  );
  assert.throws(
    () => prepareCandidateSourceIdentity(baseHtml(), forged),
    (error) => error?.code === "CANDIDATE_SOURCE_IDENTITY_FORGED"
      && error.details.forgedIds.length === 1,
  );
});

test("Candidate identity treats one valid ID as sole authority across tag and order changes", () => {
  const changed = baseHtml().replace(
    `<p ${attribute(IDS.first)}>甲</p><p ${attribute(IDS.second)}>乙</p>`,
    `<article ${attribute(IDS.second)}>乙已改写</article><p ${attribute(IDS.first)}>甲已更新</p>`,
  );
  const prepared = prepareCandidateSourceIdentity(baseHtml(), changed);
  const identity = inspectSourceElementIdentity(prepared.html);
  assert.equal(identity.complete, true);
  assert.equal(identity.claimedIds.has(IDS.first), true);
  assert.equal(identity.claimedIds.has(IDS.second), true);
  assert.equal(prepared.identityReport.retainedElementCount, 8);
  assert.equal(prepared.identityReport.deletedElementCount, 0);
  assert.equal(prepared.identityReport.assignedElementCount, 0);
});

test("Candidate identity rejects exact and stable-slot identity loss instead of guessing", () => {
  const exactLoss = baseHtml().replace(` ${attribute(IDS.second)}`, "");
  assert.throws(
    () => prepareCandidateSourceIdentity(baseHtml(), exactLoss),
    (error) => error?.code === "CANDIDATE_SOURCE_IDENTITY_LOST"
      && error.details.suspicious.some((issue) => issue.evidence === "exact-source"),
  );

  const changedInPlace = baseHtml().replace(
    `<p ${attribute(IDS.second)}>乙</p>`,
    "<p>乙已改写</p>",
  );
  assert.throws(
    () => prepareCandidateSourceIdentity(baseHtml(), changedInPlace),
    (error) => error?.code === "CANDIDATE_SOURCE_IDENTITY_LOST"
      && error.details.suspicious.some((issue) => issue.evidence === "stable-slot"),
  );
});

test("Candidate identity rejects an equal-cardinality repeated exact-source group", () => {
  const repeatedBase = baseHtml().replace(
    `<p ${attribute(IDS.first)}>甲</p><p ${attribute(IDS.second)}>乙</p>`,
    `<p ${attribute(IDS.first)}>相同</p><p ${attribute(IDS.second)}>相同</p>`,
  );
  const stripped = repeatedBase
    .replace(` ${attribute(IDS.first)}`, "")
    .replace(` ${attribute(IDS.second)}`, "");

  assert.throws(
    () => prepareCandidateSourceIdentity(repeatedBase, stripped),
    (error) => error?.code === "CANDIDATE_SOURCE_IDENTITY_LOST"
      && error.details.suspicious.some(
        (issue) => issue.evidence === "exact-source-group"
          && issue.pagerootIds.length === 2
          && issue.outputOccurrenceCount === 2,
      ),
  );
});

test("Candidate identity does not infer identity loss from unequal repeated groups", () => {
  const repeatedBase = baseHtml().replace(
    `<p ${attribute(IDS.first)}>甲</p><p ${attribute(IDS.second)}>乙</p>`,
    `<p ${attribute(IDS.first)}>相同</p><p ${attribute(IDS.second)}>相同</p>`,
  );
  const oneIdentityFreeElement = repeatedBase.replace(
    `<p ${attribute(IDS.first)}>相同</p><p ${attribute(IDS.second)}>相同</p>`,
    "<p>相同</p>",
  );
  const prepared = prepareCandidateSourceIdentity(repeatedBase, oneIdentityFreeElement, {
    randomUUIDFactory: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });

  assert.equal(prepared.identityReport.deletedElementCount, 2);
  assert.equal(prepared.identityReport.assignedElementCount, 1);
  assert.equal(inspectSourceElementIdentity(prepared.html).complete, true);
});

test("Candidate identity rejects an ambiguous stable-slot group when every old ID is stripped", () => {
  const strippedAndRewritten = baseHtml().replace(
    `<p ${attribute(IDS.first)}>甲</p><p ${attribute(IDS.second)}>乙</p>`,
    "<p>新甲</p><p>新乙</p>",
  );

  assert.throws(
    () => prepareCandidateSourceIdentity(baseHtml(), strippedAndRewritten),
    (error) => error?.code === "CANDIDATE_SOURCE_IDENTITY_LOST"
      && error.details.suspicious.some(
        (issue) => issue.evidence === "stable-slot-group"
          && issue.pagerootIds.length === 2
          && issue.outputOccurrenceCount === 2,
      ),
  );
});

test("Candidate identity does not infer an ambiguous run between retained anchors", () => {
  const ambiguous = baseHtml().replace(
    `<p ${attribute(IDS.first)}>甲</p><p ${attribute(IDS.second)}>乙</p>`,
    "<article>新甲</article><article>新乙</article>",
  );
  const prepared = prepareCandidateSourceIdentity(baseHtml(), ambiguous, {
    randomUUIDFactory: (() => {
      const values = [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ];
      return () => values.shift();
    })(),
  });
  assert.equal(prepared.identityReport.deletedElementCount, 2);
  assert.equal(prepared.identityReport.assignedElementCount, 2);
  assert.equal(inspectSourceElementIdentity(prepared.html).complete, true);
});

test("Candidate identity report rejects inconsistent persisted evidence", () => {
  const prepared = prepareCandidateSourceIdentity(baseHtml(), baseHtml());
  assert.equal(prepared.html, baseHtml());
  assert.equal(prepared.identityReport.assignedElementCount, 0);
  assert.throws(
    () => assertCandidateSourceIdentityReport({
      ...prepared.identityReport,
      retainedElementCount: prepared.identityReport.retainedElementCount - 1,
    }),
    (error) => error?.code === "CANDIDATE_IDENTITY_REPORT_INVALID",
  );
  assert.throws(
    () => assertCandidateSourceIdentityReport({
      ...prepared.identityReport,
      baseElementCount: prepared.identityReport.baseElementCount + 1,
    }),
    (error) => error?.code === "CANDIDATE_IDENTITY_REPORT_INVALID",
  );
  assert.throws(
    () => assertCandidateSourceIdentityOutput(
      prepared.identityReport,
      prepared.html.replace(IDS.second, IDS.first),
    ),
    (error) => error?.code === "CANDIDATE_IDENTITY_REPORT_INVALID",
  );
  assert.throws(
    () => assertCandidateSourceIdentityOutput(
      prepared.identityReport,
      prepared.html.replace("<p", "<article").replace("</p>", "</article>"),
    ),
    (error) => error?.code === "CANDIDATE_IDENTITY_REPORT_INVALID",
  );
});
