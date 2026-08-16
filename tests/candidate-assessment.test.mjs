import assert from "node:assert/strict";
import test from "node:test";

import {
  assessHtmlCandidate,
} from "../scripts/candidate-assessment.mjs";
import {
  normalizeCandidateAssessmentPolicy,
} from "../scripts/candidate-assessment-decoder.mjs";

function documentHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Scope fixture</title>
  <style id="shared-style">.card { color: red; }</style>
  <script id="shared-script">window.scopeFixture = 1;</script>
</head>
<body>
  <main id="target">
    <h1 class="title">目标标题</h1>
    <p id="inside">目标正文</p>
  </main>
  <aside id="outside">目标外正文</aside>
  <footer id="second-target">第二目标</footer>
</body>
</html>`;
}

test("candidate assessment ignores script changes while checking document health and continuity", () => {
  const baseHtml = documentHtml();
  const related = assessHtmlCandidate({
    baseHtml,
    outputHtml: baseHtml
      .replace('<p id="inside">', '<div id="inside">')
      .replace("</p>", "</div>"),
  });
  assert.equal(related.status, "ready");
  assert.equal(related.health.completeDocument, true);

  const unrelated = assessHtmlCandidate({
    baseHtml,
    outputHtml: `<!doctype html><html><head><title>另一页</title><script id="shared-script">window.scopeFixture = 1;</script></head><body><article>全新的内容与结构</article></body></html>`,
  });
  assert.equal(unrelated.status, "attention");
  assert.deepEqual(unrelated.issueCodes, ["PAGE_CONTINUITY_UNCERTAIN"]);

  const empty = assessHtmlCandidate({
    baseHtml,
    outputHtml: `<!doctype html><html><head><title>空页</title><script id="shared-script">window.scopeFixture = 1;</script></head><body></body></html>`,
  });
  assert.equal(empty.status, "blocked");
  assert.deepEqual(empty.issueCodes, ["HTML_BODY_EMPTY"]);

  const scriptChange = assessHtmlCandidate({
    baseHtml,
    outputHtml: baseHtml.replace(
      "window.scopeFixture = 1",
      "window.scopeFixture = 2",
    ),
  });
  assert.equal(scriptChange.status, "ready");
  assert.deepEqual(scriptChange.issueCodes, []);
  assert.equal("executable" in scriptChange, false);
  assert.equal("executableSurfaceUnchanged" in scriptChange.health, false);
});

test("historical script-change conclusions are normalized out of current policy", () => {
  const current = assessHtmlCandidate({
    baseHtml: documentHtml(),
    outputHtml: documentHtml().replace(
      "window.scopeFixture = 1",
      "window.scopeFixture = 2",
    ),
  });
  const legacy = {
    ...current,
    status: "blocked",
    issueCodes: ["EXECUTABLE_CONTENT_CHANGED"],
    health: {
      ...current.health,
      executableSurfaceUnchanged: false,
    },
    executable: {
      unchanged: false,
      baseCount: 1,
      outputCount: 1,
      changedCount: 1,
    },
  };

  const normalized = normalizeCandidateAssessmentPolicy(legacy);
  assert.equal(normalized.status, "ready");
  assert.deepEqual(normalized.issueCodes, []);
  assert.equal("executable" in normalized, false);
  assert.equal("executableSurfaceUnchanged" in normalized.health, false);

  const currentRecordWithUnexpectedConclusion = {
    ...current,
    status: "blocked",
    issueCodes: ["UNEXPECTED_CONCLUSION"],
  };
  assert.deepEqual(
    normalizeCandidateAssessmentPolicy(currentRecordWithUnexpectedConclusion),
    currentRecordWithUnexpectedConclusion,
  );
});
