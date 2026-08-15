import assert from "node:assert/strict";
import {
  access,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "../node_modules/schema-utils/node_modules/ajv/dist/2020.js";
import {
  readStatus,
  runOfficialFinalizer,
  submitRequest,
  writeAttemptOutput,
} from "./helpers/ai-attempt-fixture.mjs";
import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";

import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  createInsertionPointTargetRef,
  createTargetRef,
} from "../app/lib/target-resolver.js";
import {
  assessHtmlCandidate,
} from "../scripts/candidate-assessment.mjs";
import {
  normalizeCandidateAssessmentPolicy,
} from "../scripts/candidate-assessment-decoder.mjs";
import { injectManagedMeta, sha256 } from "../scripts/lifecycle-core.mjs";
import { validateScope } from "../scripts/scope-validator.mjs";

const productRoot = fileURLToPath(new URL("../", import.meta.url));

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

function identity() {
  return {
    projectId: "project_scope",
    documentId: "doc_scope",
    requestId: "req_0001",
    attemptId: "attempt_001",
    generatedAt: "2026-07-18T10:00:00.000Z",
  };
}

function regularTarget(selector = "#target", targetId = "target_main") {
  return {
    targetId,
    label: targetId,
    level: "module",
    selector,
    resolution: "exact",
  };
}

function textTarget(baseHtml, elementId = "inside") {
  const index = buildSourceIndex(baseHtml);
  const element = index.elements.find(
    (candidate) => candidate.stableAttributes.id === elementId,
  );
  assert.ok(element, `missing #${elementId}`);
  return createTargetRef(index, element.nodeId, { level: "text" });
}

function reportFor(outputHtml, allowedTargets = [regularTarget()]) {
  return validateScope({
    ...identity(),
    baseHtml: documentHtml(),
    outputHtml,
    allowedTargets,
  });
}

async function scopeSchemaValidator() {
  const schema = JSON.parse(
    await readFile(
      join(productRoot, "schemas", "scope-report.v1.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateSchema: true,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  return ajv.compile(schema);
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

test("scope report is strict and classifies target-inside text, attributes, structure and inline style", async () => {
  const output = documentHtml()
    .replace("目标标题", "新的目标标题")
    .replace(
      '<main id="target">',
      '<main id="target" data-state="updated" style="color: blue">',
    )
    .replace(
      '<p id="inside">目标正文</p>',
      '<p id="inside">目标正文</p><section id="inside-added">新增结构</section>',
    );
  const report = reportFor(output);
  assert.equal(report.verdict, "pass");
  assert.equal(report.summary.violationCount, 0);
  assert.deepEqual(
    new Set(report.differences.map((difference) => difference.kind)),
    new Set(["text", "attribute", "inline-style", "structure"]),
  );
  assert.ok(
    report.differences
      .filter((difference) => difference.material)
      .every(
        (difference) =>
          difference.classification === "target-inside"
          && difference.targetIds.includes("target_main"),
      ),
  );
  const validate = await scopeSchemaValidator();
  assert.equal(
    validate(report),
    true,
    validate.errors?.map((error) => JSON.stringify(error)).join("\n"),
  );
});

test("out-of-target text, attributes, structure, shared CSS and JavaScript are material violations", () => {
  const cases = [
    {
      label: "text",
      expectedKind: "text",
      mutate: (html) => html.replace("目标外正文", "越界正文"),
    },
    {
      label: "attribute",
      expectedKind: "attribute",
      mutate: (html) =>
        html.replace(
          '<aside id="outside">',
          '<aside id="outside" data-rogue="true">',
        ),
    },
    {
      label: "structure",
      expectedKind: "structure",
      mutate: (html) =>
        html.replace(
          '<aside id="outside">',
          '<section id="rogue">越界结构</section><aside id="outside">',
        ),
    },
    {
      label: "shared CSS",
      expectedKind: "shared-css",
      mutate: (html) => html.replace("color: red", "color: blue"),
    },
    {
      label: "JavaScript",
      expectedKind: "script",
      mutate: (html) =>
        html.replace("window.scopeFixture = 1", "window.scopeFixture = 2"),
    },
  ];
  for (const { label, expectedKind, mutate } of cases) {
    const report = reportFor(mutate(documentHtml()));
    assert.equal(report.verdict, "fail", label);
    assert.ok(report.summary.violationCount >= 1, label);
    assert.ok(
      report.differences.some(
        (difference) =>
          difference.kind === expectedKind
          && difference.classification === "target-outside"
          && difference.material
          && !difference.allowed,
      ),
      label,
    );
  }
});

test("multiple targets form an exact union and do not widen to their parent", () => {
  const output = documentHtml()
    .replace("目标正文", "目标一已改")
    .replace("第二目标", "目标二已改");
  const report = reportFor(output, [
    regularTarget("#target", "target_main"),
    regularTarget("#second-target", "target_second"),
  ]);
  assert.equal(report.verdict, "pass");
  assert.deepEqual(
    new Set(
      report.differences
        .filter((difference) => difference.kind === "text")
        .flatMap((difference) => difference.targetIds),
    ),
    new Set(["target_main", "target_second"]),
  );

  const widened = validateScope({
    ...identity(),
    baseHtml: documentHtml(),
    outputHtml: output.replace("目标外正文", "仍然越界"),
    allowedTargets: [
      regularTarget("#target", "target_main"),
      regularTarget("#second-target", "target_second"),
    ],
  });
  assert.equal(widened.verdict, "fail");
  assert.ok(widened.violationCodes.includes("TARGET_OUTSIDE_TEXT"));
});

test("a changed duplicate label stays bound to its frozen structural ancestor", () => {
  const base = `<!doctype html><html><head><title>duplicate</title></head><body><header><span class="brand">Atlas Lab</span></header><main>正文</main><footer><span class="brand">Atlas Lab</span></footer></body></html>`;
  const index = buildSourceIndex(base);
  const duplicateLabels = index.elements.filter(
    (element) => element.tagName === "span" && element.textContent === "Atlas Lab",
  );
  assert.equal(duplicateLabels.length, 2);
  const footerTarget = createTargetRef(
    index,
    duplicateLabels[1].nodeId,
    { level: "subregion" },
  );
  const report = validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml: base.replace(
      "<footer><span class=\"brand\">Atlas Lab</span></footer>",
      "<footer><span class=\"brand\">Atlas Lab 2035</span></footer>",
    ),
    allowedTargets: [footerTarget],
  });
  assert.equal(report.verdict, "pass");
  assert.ok(!report.violationCodes.includes("TARGET_ROOT_TOPOLOGY_CHANGED"));
  assert.match(report.allowedTargets[0].resolution.outputPath, /footer/u);
});

test("a sealed active supplement authorizes only the exact values it names", () => {
  const supplement = {
    recordId: "supplement_0001",
    userText: "把活跃项目从 156 个改为 164 个",
    targetDescription: "活跃项目指标卡",
  };
  const changed = documentHtml().replace(
    '<aside id="outside">目标外正文</aside>',
    '<aside id="outside"><span>活跃项目</span><strong>156</strong></aside>',
  );
  const output = changed.replace("<strong>156</strong>", "<strong>164</strong>");
  const authorized = validateScope({
    ...identity(),
    baseHtml: changed,
    outputHtml: output,
    allowedTargets: [regularTarget()],
    supplementRecords: [supplement],
  });
  assert.equal(authorized.verdict, "pass");
  assert.ok(
    authorized.differences.some((difference) =>
      difference.targetIds.includes("target_supplement_supplement_0001")
    ),
  );

  const unrelated = validateScope({
    ...identity(),
    baseHtml: changed,
    outputHtml: output.replace("第二目标", "未授权变化"),
    allowedTargets: [regularTarget()],
    supplementRecords: [supplement],
  });
  assert.equal(unrelated.verdict, "fail");
  assert.ok(unrelated.violationCodes.includes("TARGET_OUTSIDE_TEXT"));
});

test("a sealed supplement resolves one unique frozen location and rejects repeated-value widening", () => {
  const supplement = {
    recordId: "supplement_0001",
    userText: "把活跃项目从 156 个改为 164 个",
    targetDescription: "活跃项目指标卡",
  };
  const base = documentHtml()
    .replace(
      '<aside id="outside">目标外正文</aside>',
      '<aside id="outside"><span>活跃项目</span><strong>156</strong></aside>',
    )
    .replace(
      "</body>",
      '<section id="other-metric"><strong>156</strong></section></body>',
    );
  const targetOnly = base.replace(
    '<aside id="outside"><span>活跃项目</span><strong>156</strong></aside>',
    '<aside id="outside"><span>活跃项目</span><strong>164</strong></aside>',
  );
  const authorized = validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml: targetOnly,
    allowedTargets: [regularTarget()],
    supplementRecords: [supplement],
  });
  assert.equal(authorized.verdict, "pass");
  assert.match(
    authorized.allowedTargets.find(
      (target) => target.targetId === "target_supplement_supplement_0001",
    )?.resolution.reason ?? "",
    /Unique frozen context "活跃项目"/u,
  );

  const wrongOccurrence = validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml: base.replace(
      '<section id="other-metric"><strong>156</strong></section>',
      '<section id="other-metric"><strong>164</strong></section>',
    ),
    allowedTargets: [regularTarget()],
    supplementRecords: [supplement],
  });
  assert.equal(wrongOccurrence.verdict, "fail");
  assert.ok(wrongOccurrence.violationCodes.includes("TARGET_OUTSIDE_TEXT"));

  const widened = validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml: targetOnly.replace(
      '<section id="other-metric"><strong>156</strong></section>',
      '<section id="other-metric"><strong>164</strong></section>',
    ),
    allowedTargets: [regularTarget()],
    supplementRecords: [supplement],
  });
  assert.equal(widened.verdict, "fail");
  assert.ok(widened.violationCodes.includes("TARGET_OUTSIDE_TEXT"));

  const ambiguousBase = base.replace(
    '<section id="other-metric"><strong>156</strong></section>',
    '<section id="other-metric"><span>活跃项目</span><strong>156</strong></section>',
  );
  const ambiguous = validateScope({
    ...identity(),
    baseHtml: ambiguousBase,
    outputHtml: ambiguousBase.replace(
      '<aside id="outside"><span>活跃项目</span><strong>156</strong></aside>',
      '<aside id="outside"><span>活跃项目</span><strong>164</strong></aside>',
    ),
    allowedTargets: [regularTarget()],
    supplementRecords: [supplement],
  });
  assert.equal(ambiguous.verdict, "fail");
  assert.ok(ambiguous.violationCodes.includes("TARGET_OUTSIDE_TEXT"));
});

test("a frozen target root cannot be reparented or reordered without an explicit topology guard", () => {
  const reparentBase = `<!doctype html><html><head><title>move</title></head><body><section id="left"><article id="moving">A</article></section><section id="right"></section></body></html>`;
  const reparented = reparentBase.replace(
    '<section id="left"><article id="moving">A</article></section><section id="right"></section>',
    '<section id="left"></section><section id="right"><article id="moving">A</article></section>',
  );
  const movingTarget = regularTarget("#moving", "target_moving");
  const rejectedMove = validateScope({
    ...identity(),
    baseHtml: reparentBase,
    outputHtml: reparented,
    allowedTargets: [movingTarget],
  });
  assert.equal(rejectedMove.verdict, "fail");
  assert.ok(
    rejectedMove.violationCodes.includes("TARGET_ROOT_TOPOLOGY_CHANGED"),
  );

  const moveIndex = buildSourceIndex(reparentBase);
  const right = moveIndex.elements.find(
    (element) => element.stableAttributes.id === "right",
  );
  assert.ok(right);
  const insertionGuard = createInsertionPointTargetRef(moveIndex, {
    parentId: right.nodeId,
    targetId: "target_move_destination",
  });
  const acceptedMove = validateScope({
    ...identity(),
    baseHtml: reparentBase,
    outputHtml: reparented,
    allowedTargets: [movingTarget, insertionGuard],
  });
  assert.equal(acceptedMove.verdict, "pass");

  const reorderBase = `<!doctype html><html><head><title>order</title></head><body><main id="parent"><article id="moving">A</article><aside id="sibling">B</aside></main></body></html>`;
  const reordered = reorderBase.replace(
    '<article id="moving">A</article><aside id="sibling">B</aside>',
    '<aside id="sibling">B</aside><article id="moving">A</article>',
  );
  const rejectedReorder = validateScope({
    ...identity(),
    baseHtml: reorderBase,
    outputHtml: reordered,
    allowedTargets: [movingTarget],
  });
  assert.equal(rejectedReorder.verdict, "fail");
  assert.ok(
    rejectedReorder.violationCodes.includes("TARGET_ROOT_TOPOLOGY_CHANGED"),
  );
  const acceptedReorder = validateScope({
    ...identity(),
    baseHtml: reorderBase,
    outputHtml: reordered,
    allowedTargets: [
      movingTarget,
      regularTarget("#parent", "target_parent"),
    ],
  });
  assert.equal(acceptedReorder.verdict, "pass");
});

test("an insertion-point permits only additions at its frozen sibling boundary", () => {
  const base = documentHtml();
  const insertionOffset = base.indexOf('  <aside id="outside">');
  const insertionTarget = {
    targetId: "target_insert",
    label: "在主模块与侧栏之间插入",
    level: "insertion-point",
    selector: "body",
    sourceAnchor: {
      startOffset: insertionOffset,
      endOffset: insertionOffset,
      sourceSha256: sha256(Buffer.from(base, "utf8")),
    },
    resolution: "exact",
  };
  const inserted = base.replace(
    '  <aside id="outside">',
    '  <section id="inserted">插入内容</section>\n  <aside id="outside">',
  );
  const accepted = reportFor(inserted, [insertionTarget]);
  assert.equal(accepted.verdict, "pass");
  assert.ok(
    accepted.differences.some(
      (difference) =>
        difference.operation === "add"
        && difference.targetIds.includes("target_insert"),
    ),
  );

  const wrongGap = base.replace(
    '  <footer id="second-target">',
    '  <section id="inserted">插入到了错误位置</section>\n  <footer id="second-target">',
  );
  const rejected = reportFor(wrongGap, [insertionTarget]);
  assert.equal(rejected.verdict, "fail");
  assert.ok(rejected.violationCodes.includes("TARGET_OUTSIDE_STRUCTURE"));
});

test("a core-generated insertion target resolves its parent and permits only the selected child boundary", () => {
  const base = `<!doctype html><html><head><title>insert</title></head><body><main id="parent"><p id="a">A</p><p id="b">B</p></main><aside id="outside">outside</aside></body></html>`;
  const index = buildSourceIndex(base);
  const parent = index.elements.find(
    (element) => element.stableAttributes.id === "parent",
  );
  const before = index.elements.find(
    (element) => element.stableAttributes.id === "b",
  );
  assert.ok(parent);
  assert.ok(before);
  const target = createInsertionPointTargetRef(index, {
    parentId: parent.nodeId,
    beforeSiblingId: before.nodeId,
    targetId: "target_core_insert",
  });

  const accepted = validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml: base.replace(
      '<p id="b">',
      '<section id="inserted">new</section><p id="b">',
    ),
    allowedTargets: [target],
  });
  assert.equal(accepted.verdict, "pass");
  assert.ok(
    accepted.differences.some(
      (difference) =>
        difference.operation === "add"
        && difference.targetIds.includes("target_core_insert"),
    ),
  );

  const rejected = validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml: base.replace(
      '<aside id="outside">',
      '<section id="inserted">wrong gap</section><aside id="outside">',
    ),
    allowedTargets: [target],
  });
  assert.equal(rejected.verdict, "fail");
  assert.ok(rejected.violationCodes.includes("TARGET_OUTSIDE_STRUCTURE"));
});

test("a text TargetRef authorizes only its exact text node value", () => {
  const base = documentHtml();
  const target = textTarget(base);
  const validate = (outputHtml) => validateScope({
    ...identity(),
    baseHtml: base,
    outputHtml,
    allowedTargets: [target],
  });

  const textOnly = validate(base.replace("目标正文", "目标正文已更新"));
  assert.equal(textOnly.verdict, "pass");
  assert.ok(
    textOnly.differences.some(
      (difference) =>
        difference.kind === "text"
        && difference.targetIds.includes(target.targetId),
    ),
  );

  const parentAttribute = validate(
    base.replace('<p id="inside">', '<p id="inside" onclick="evil()">'),
  );
  assert.equal(parentAttribute.verdict, "fail");
  assert.ok(parentAttribute.violationCodes.includes("SCRIPT_OUTSIDE_TARGET"));

  const structuralReplacement = validate(
    base.replace("目标正文", "<strong>目标正文</strong>"),
  );
  assert.equal(structuralReplacement.verdict, "fail");
  assert.ok(
    structuralReplacement.differences.some(
      (difference) =>
        difference.kind === "structure"
        && !difference.allowed,
    ),
  );
});

test("raw start-tag comparison preserves duplicate attribute multiplicity", () => {
  const duplicateId = reportFor(
    documentHtml().replace(
      '<aside id="outside">',
      '<aside id="outside" id="shadow">',
    ),
  );
  assert.equal(duplicateId.verdict, "fail");
  assert.ok(duplicateId.violationCodes.includes("TARGET_OUTSIDE_ATTRIBUTE"));

  const onclickBase = documentHtml().replace(
    '<aside id="outside">',
    '<aside id="outside" onclick="safe()">',
  );
  const duplicateOnclick = validateScope({
    ...identity(),
    baseHtml: onclickBase,
    outputHtml: onclickBase.replace(
      '<aside id="outside" onclick="safe()">',
      '<aside id="outside" onclick="safe()" onclick="evil()">',
    ),
    allowedTargets: [regularTarget()],
  });
  assert.equal(duplicateOnclick.verdict, "fail");
  assert.ok(
    duplicateOnclick.violationCodes.includes("SCRIPT_OUTSIDE_TARGET"),
  );

  const normalizationBase = documentHtml().replace(
    '<aside id="outside">',
    '<aside id="outside" data-note="a &amp; b">',
  );
  const normalization = validateScope({
    ...identity(),
    baseHtml: normalizationBase,
    outputHtml: normalizationBase.replace(
      '<aside id="outside" data-note="a &amp; b">',
      "<aside data-note='a &amp; b'   id = 'outside'>",
    ),
    allowedTargets: [regularTarget()],
  });
  assert.equal(normalization.verdict, "pass");
  assert.ok(
    normalization.differences.some(
      (difference) => difference.kind === "semantic-normalization",
    ),
  );
});

test("duplicate attribute order is material because the first value is effective", () => {
  const baseHtml = "<!doctype html><html><head><title>x</title></head><body><main><div id=\"first\" id=\"second\">x</div></main></body></html>";
  const outputHtml = baseHtml.replace(
    'id="first" id="second"',
    'id="second" id="first"',
  );
  const report = validateScope({
    ...identity(),
    baseHtml,
    outputHtml,
    allowedTargets: [],
  });
  assert.equal(report.verdict, "fail");
  assert.ok(
    report.differences.some(
      (difference) =>
        difference.kind === "attribute"
        && difference.attributeName === "id"
        && difference.material
        && !difference.allowed,
    ),
  );
});

test("a structurally mapped anonymous target survives its own text edit", () => {
  const baseHtml = "<!doctype html><html><head><title>x</title></head><body><main><section>旧内容</section><aside>安全</aside></main></body></html>";
  const index = buildSourceIndex(baseHtml);
  const section = index.elements.find((element) => element.tagName === "section");
  assert.ok(section);
  const target = createTargetRef(index, section.nodeId);
  assert.match(target.selector, /nth-of-type/u);
  const outputHtml = baseHtml.replace("旧内容", "新内容");
  const report = validateScope({
    ...identity(),
    baseHtml,
    outputHtml,
    allowedTargets: [target],
  });
  assert.equal(report.verdict, "pass");
  assert.ok(
    report.allowedTargets.some(
      (resolution) =>
        resolution.targetId === target.targetId
        && resolution.resolution.output === "rebound",
    ),
  );
});

test("only the five exact finalizer meta names and semantic normalizations are non-material", async () => {
  const managedIdentity = {
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0002",
    versionLabel: "V2",
    basedOnVersionId: "ver_0001",
    requestId: "req_0001",
  };
  const expectedManagedMetadata = {
    "html-ai-document-id": managedIdentity.documentId,
    "html-ai-version-id": managedIdentity.versionId,
    "html-ai-version-label": managedIdentity.versionLabel,
    "html-ai-based-on-version-id": managedIdentity.basedOnVersionId,
    "html-ai-request-id": managedIdentity.requestId,
  };
  const stamped = injectManagedMeta(documentHtml(), managedIdentity)
    .replace('id="outside"', "id='outside'");
  const report = reportFor(stamped);
  assert.equal(report.verdict, "pass");
  assert.ok(
    report.differences.some(
      (difference) =>
        difference.kind === "finalizer-metadata"
        && difference.classification === "finalizer-metadata"
        && !difference.material,
    ),
  );
  assert.ok(
    report.differences.some(
      (difference) =>
        difference.kind === "semantic-normalization"
        && difference.classification === "semantic-equivalent"
        && !difference.material,
    ),
  );
  assert.deepEqual(report.managedMetadataWhitelist, [
    "html-ai-document-id",
    "html-ai-version-id",
    "html-ai-version-label",
    "html-ai-based-on-version-id",
    "html-ai-request-id",
  ]);
  const validate = await scopeSchemaValidator();
  assert.equal(validate(report), true);

  for (const poisoned of [
    stamped.replace('content="ver_0002"', 'content="ver_9999"'),
    stamped.replace(
      "</head>",
      `<meta name="html-ai-document-id" content="${managedIdentity.documentId}"></head>`,
    ),
  ]) {
    const poisonedReport = validateScope({
      ...identity(),
      baseHtml: documentHtml(),
      outputHtml: poisoned,
      allowedTargets: [regularTarget()],
      expectedManagedMetadata,
    });
    assert.equal(poisonedReport.verdict, "fail");
    assert.ok(
      poisonedReport.violationCodes.includes("OUTPUT_MANAGED_META_MISMATCH"),
    );
    assert.ok(
      poisonedReport.differences.some(
        (difference) =>
          difference.kind === "finalizer-metadata"
          && difference.material
          && !difference.allowed,
      ),
    );
  }

  const customMetadata = documentHtml().replace(
    "</head>",
    '<meta name="html-ai-custom-note" content="not-finalizer-owned"></head>',
  );
  const rejected = reportFor(customMetadata);
  assert.equal(rejected.verdict, "fail");
  assert.ok(
    rejected.differences.some(
      (difference) =>
        difference.kind === "structure"
        && difference.classification === "target-outside",
    ),
  );
});

test("ambiguous and orphaned targets fail closed instead of widening scope", () => {
  const ambiguous = reportFor(
    documentHtml().replace("目标正文", "不应被接受"),
    [
      {
        targetId: "target_ambiguous",
        label: "重复元素",
        level: "module",
        selector: "body *",
        resolution: "exact",
      },
    ],
  );
  assert.equal(ambiguous.verdict, "fail");
  assert.ok(ambiguous.violationCodes.includes("TARGET_AMBIGUOUS"));
  assert.ok(
    ambiguous.differences.some(
      (difference) => difference.kind === "target-resolution",
    ),
  );

  const orphaned = reportFor(
    documentHtml().replace("目标正文", "不应被接受"),
    [
      {
        targetId: "target_missing",
        label: "不存在的元素",
        level: "module",
        selector: "#does-not-exist",
        resolution: "exact",
      },
    ],
  );
  assert.equal(orphaned.verdict, "fail");
  assert.ok(orphaned.violationCodes.includes("TARGET_ORPHANED"));
});

test("a stale positional selector cannot retarget an inserted sibling", () => {
  const baseHtml = `<!doctype html>
<html>
<head><title>positional identity</title></head>
<body>
  <main>
    <section></section>
    <aside id="outside">safe</aside>
  </main>
</body>
</html>`;
  const index = buildSourceIndex(baseHtml);
  const anonymousSection = index.elements.find(
    (element) =>
      element.tagName === "section"
      && Object.keys(element.stableAttributes).length === 0
      && !element.textContent,
  );
  assert.ok(anonymousSection);
  const target = createTargetRef(index, anonymousSection.nodeId);
  assert.match(target.selector, /:nth-of-type\(1\)/u);

  const outputHtml = baseHtml.replace(
    "    <section></section>",
    '    <section data-rogue="true">malicious insertion</section>\n    <section></section>',
  );
  const report = validateScope({
    ...identity(),
    baseHtml,
    outputHtml,
    allowedTargets: [target],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(!report.violationCodes.includes("TARGET_ORPHANED"));
  assert.ok(
    report.differences.some(
      (difference) =>
        difference.operation === "add"
        && difference.classification === "target-outside"
        && !difference.allowed,
    ),
  );
  assert.ok(
    report.differences.some(
      (difference) =>
        difference.operation === "add"
        && difference.classification === "target-outside"
        && !difference.allowed,
    ),
  );

  const selectorOnlyReport = validateScope({
    ...identity(),
    baseHtml,
    outputHtml,
    allowedTargets: [{
      targetId: "selector_only",
      label: "selector only",
      level: "module",
      selector: target.selector,
      resolution: "exact",
    }],
  });
  assert.equal(selectorOnlyReport.verdict, "fail");
  assert.ok(selectorOnlyReport.violationCodes.includes("TARGET_ORPHANED"));
});

test("workspace lifecycle treats comment targets as guidance for every HTML change", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "html-ai-text-scope-",
  });
  const sourcePath = await environment.createSource(
    "text-scope.html",
    documentHtml(),
  );
  const bridge = await environment.start();

  const preview = (
    await bridge.requestJson(
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    )
  ).body;
  assert.equal(preview.registered, false);
  const opened = (
    await bridge.postJson("/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.currentHtmlSha256,
    })
  ).body;
  assert.equal(opened.registered, true);
  const frozenSource = await readFile(sourcePath, "utf8");
  const target = textTarget(frozenSource);
  const candidateCases = [
    [
      "script",
      (html) => html.replace(
        '<p id="inside">',
        '<p id="inside" onclick="evil()">',
      ),
    ],
    [
      "attribute",
      (html) => html.replace(
        '<p id="inside">',
        '<p id="inside" data-shadow="true">',
      ),
    ],
    [
      "structure",
      (html) => html.replace("目标正文", "<strong>目标正文</strong>"),
    ],
  ];

  let readyCaseCount = 0;
  for (const [expectedKind, mutate] of candidateCases) {
    const run = (
      await submitRequest(bridge, {
        sourcePath,
        projectId: opened.projectId,
        documentId: opened.documentId,
        expectedSourceSha256: opened.currentHtmlSha256,
        freezeCutoffRevision: 0,
        summary: `允许 text scope ${expectedKind} widening`,
        targets: [target],
        instructions: [
          {
            instructionId: `instruction_text_${expectedKind}`,
            text: "只修改目标文字值。",
            targetRefs: [target.targetId],
          },
        ],
      })
    ).body;
    assert.equal(
      run.candidateVersionId,
      "ver_0002",
    );
    const base = await readFile(run.inputPath, "utf8");
    await writeAttemptOutput(run, mutate(base));
    await runOfficialFinalizer(environment.workspace, run);
    const status = await readStatus(bridge, { sourcePath, ...run });
    const candidateAssessment = status.body.candidateAssessment || JSON.parse(
      await readFile(join(run.attemptPath, "candidate-assessment.json"), "utf8"),
    );
    readyCaseCount += 1;
    assert.equal(status.body.status, "ready-to-open");
    assert.equal(candidateAssessment.status, "ready");
    assert.equal("executable" in candidateAssessment, false);
    const cancelled = await bridge.postJson(
      "/active-run/cancel",
      {
        sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
      },
    );
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    await assert.rejects(access(join(
      opened.projectRoot,
      "versions",
      run.candidateVersionId,
    )));
    await assert.rejects(access(join(run.attemptPath, "scope-report.json")));
    await assert.rejects(access(join(run.attemptPath, "validation-review.json")));
    assert.equal(await readFile(sourcePath, "utf8"), frozenSource);
  }
  assert.equal(readyCaseCount, 3);

  const acceptedRun = (
    await submitRequest(bridge, {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "只更新 text scope 值",
      targets: [target],
      instructions: [
        {
          instructionId: "instruction_text_value",
          text: "只修改目标文字值。",
          targetRefs: [target.targetId],
        },
      ],
    })
  ).body;
  assert.match(acceptedRun.candidateVersionId, /^ver_\d{4,}$/);
  const acceptedBase = await readFile(acceptedRun.inputPath, "utf8");
  await writeAttemptOutput(
    acceptedRun,
    acceptedBase.replace("目标正文", "目标正文已更新"),
  );
  await runOfficialFinalizer(environment.workspace, acceptedRun);
  const accepted = await readStatus(bridge, { sourcePath, ...acceptedRun });
  assert.equal(accepted.body.status, "ready-to-open");
  assert.equal(accepted.body.versionId, acceptedRun.candidateVersionId);
  assert.equal(accepted.body.candidateAssessment.status, "ready");
  assert.equal(acceptedRun.candidateVersionId, "ver_0002");
  const adopted = await bridge.postJson("/ready-version/activate", {
    sourcePath,
    projectId: accepted.body.projectId,
    documentId: accepted.body.documentId,
    requestId: accepted.body.requestId,
    attemptId: accepted.body.attemptId,
    versionId: accepted.body.versionId,
  });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.status, "version-activated");
  assert.deepEqual(
    (await readdir(join(opened.projectRoot, "versions")))
      .filter((name) => /^ver_\d+$/u.test(name))
      .sort(),
    ["ver_0001", "ver_0002"],
  );
});

test("an unrelated but usable HTML candidate is preserved with mandatory-review attention", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "html-ai-soft-scope-observed-",
  });
  const originalHtml = documentHtml();
  const sourcePath = await environment.createSource("soft-scope.html", originalHtml);
  const bridge = await environment.start();

  const preview = (
    await bridge.requestJson(
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    )
  ).body;
  const opened = (
    await bridge.postJson("/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.currentHtmlSha256,
    })
  ).body;
  const target = regularTarget();
  const run = (
    await submitRequest(bridge, {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      expectedSourceSha256: opened.currentHtmlSha256,
      freezeCutoffRevision: 0,
      summary: "验证用户可明确忽略的范围提醒",
      targets: [target],
      instructions: [
        {
          instructionId: "instruction_soft_scope",
          text: "只修改目标模块。",
          targetRefs: [target.targetId],
        },
      ],
  })
  ).body;
  const frozenHtml = await readFile(run.inputPath, "utf8");
  await writeAttemptOutput(
    run,
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>完全不同的页面</title>
  <script id="shared-script">window.scopeFixture = 1;</script>
</head>
<body>
  <article><h1>另一份产品说明</h1><p>这里没有沿用原页面内容。</p></article>
</body>
</html>`,
  );
  await runOfficialFinalizer(environment.workspace, run);

  const ready = await readStatus(bridge, { sourcePath, ...run });
  assert.equal(ready.response.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.status, "ready-to-open");
  assert.equal(ready.body.candidateAssessment.status, "attention");
  assert.deepEqual(
    ready.body.candidateAssessment.issueCodes,
    ["PAGE_CONTINUITY_UNCERTAIN"],
  );
  assert.equal(ready.body.versionId, "ver_0002");
  assert.equal(ready.body.currentPath, sourcePath);
  assert.equal(ready.body.workingCopyPath, sourcePath);
  assert.equal(await readFile(sourcePath, "utf8"), originalHtml);

  const persistedAssessment = JSON.parse(
    await readFile(join(run.attemptPath, "candidate-assessment.json"), "utf8"),
  );
  assert.equal(persistedAssessment.status, "attention");
  await assert.rejects(access(join(run.attemptPath, "scope-report.json")));
  await assert.rejects(access(join(run.attemptPath, "validation-review.json")));
  assert.notEqual(frozenHtml, await readFile(run.outputPath, "utf8"));

  persistedAssessment.requestId = "req_tampered";
  await writeFile(
    join(run.attemptPath, "candidate-assessment.json"),
    `${JSON.stringify(persistedAssessment, null, 2)}\n`,
    "utf8",
  );
  const tampered = await readStatus(bridge, { sourcePath, ...run });
  assert.equal(tampered.response.status, 409);
  assert.equal(
    tampered.body.error.code,
    "CANDIDATE_ASSESSMENT_IDENTITY_MISMATCH",
  );
});

test("workspace lifecycle accepts broad page and script edits without content-based blocking", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "html-ai-scope-lifecycle-",
  });
  const sourcePath = await environment.createSource("scope.html", documentHtml());
  const bridge = await environment.start();

  const preview = (
    await bridge.requestJson(
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    )
  ).body;
  assert.equal(preview.registered, false);
  const opened = (
    await bridge.postJson("/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.currentHtmlSha256,
    })
  ).body;
  assert.equal(opened.registered, true);
  const target = regularTarget();
  const candidateCases = [
    ["text", (html) => html.replace("目标外正文", "越界正文")],
    [
      "attribute",
      (html) =>
        html.replace(
          '<aside id="outside">',
          '<aside id="outside" data-rogue="true">',
        ),
    ],
    [
      "structure",
      (html) =>
        html.replace(
          '<aside id="outside">',
          '<section id="rogue">越界结构</section><aside id="outside">',
        ),
    ],
    ["shared-css", (html) => html.replace("color: red", "color: blue")],
    [
      "script",
      (html) =>
        html.replace("window.scopeFixture = 1", "window.scopeFixture = 2"),
    ],
  ];

  let expectedSourceSha256 = opened.currentHtmlSha256;
  const expectedVersionIds = ["ver_0001"];
  for (const [expectedKind, mutate] of candidateCases) {
    const run = (
      await submitRequest(bridge, {
        sourcePath,
        projectId: opened.projectId,
        documentId: opened.documentId,
        expectedSourceSha256,
        freezeCutoffRevision: 0,
        summary: `允许目标外 ${expectedKind}`,
        targets: [target],
        instructions: [
          {
            instructionId: `instruction_${expectedKind.replace("-", "_")}`,
            text: "只修改目标模块。",
            targetRefs: [target.targetId],
          },
        ],
      })
    ).body;
    const expectedCandidateVersionId = "ver_0002";
    assert.equal(run.candidateVersionId, expectedCandidateVersionId, expectedKind);
    const frozenHtml = await readFile(run.inputPath, "utf8");
    await writeAttemptOutput(run, mutate(frozenHtml));
    await runOfficialFinalizer(environment.workspace, run);
    const status = await readStatus(bridge, { sourcePath, ...run });
    assert.equal(status.response.status, 200, expectedKind);
    assert.equal(status.body.status, "ready-to-open", expectedKind);
    assert.equal(status.body.candidateAssessment.status, "ready", expectedKind);
    const assessmentPath = join(run.attemptPath, "candidate-assessment.json");
    const outcomePath = join(run.attemptPath, "outcome.json");
    await Promise.all([
      access(run.outputPath),
      access(run.completionPath),
      access(assessmentPath),
    ]);
    const persistedAssessment = JSON.parse(
      await readFile(assessmentPath, "utf8"),
    );
    assert.equal(persistedAssessment.status, "ready", expectedKind);
    assert.equal("executable" in persistedAssessment, false, expectedKind);
    await assert.rejects(access(join(run.attemptPath, "scope-report.json")));
    await assert.rejects(access(join(run.attemptPath, "validation-review.json")));
    const cancelled = await bridge.postJson(
      "/active-run/cancel",
      {
        sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
      },
    );
    assert.equal(cancelled.response.status, 200, expectedKind);
    assert.equal(cancelled.body.status, "cancelled", expectedKind);
    await access(outcomePath);
    const persistedOutcome = JSON.parse(
      await readFile(outcomePath, "utf8"),
    );
    assert.equal(persistedOutcome.status, "cancelled", expectedKind);
    const projectRoot = opened.projectRoot;
    const versionIds = (await readdir(join(projectRoot, "versions")))
      .filter((name) => /^ver_\d+$/.test(name));
    assert.deepEqual(versionIds, expectedVersionIds, expectedKind);
    const transactionEntries = await readdir(
      join(projectRoot, "transactions"),
    );
    assert.equal(
      transactionEntries.length,
      expectedVersionIds.length - 1,
      expectedKind,
    );
    const runtime = JSON.parse(
      await readFile(join(projectRoot, "runtime-state.json"), "utf8"),
    );
    assert.equal(runtime.lifecycleState, "editing", expectedKind);
    assert.equal(runtime.activeRun, null, expectedKind);
    assert.equal(await readFile(sourcePath, "utf8"), frozenHtml, expectedKind);
    expectedSourceSha256 = sha256(await readFile(sourcePath));
  }

  const acceptedRun = (
    await submitRequest(bridge, {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      expectedSourceSha256,
      freezeCutoffRevision: 0,
      summary: "只修改目标内正文",
      targets: [target],
      instructions: [
        {
          instructionId: "instruction_inside",
          text: "修改目标内正文。",
          targetRefs: [target.targetId],
        },
      ],
    })
  ).body;
  const acceptedVersionId = "ver_0002";
  assert.equal(acceptedRun.candidateVersionId, acceptedVersionId);
  const acceptedBase = await readFile(acceptedRun.inputPath, "utf8");
  await writeAttemptOutput(
    acceptedRun,
    acceptedBase.replace("目标正文", "目标正文已更新"),
  );
  await runOfficialFinalizer(environment.workspace, acceptedRun);
  const accepted = await readStatus(bridge, { sourcePath, ...acceptedRun });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.status, "ready-to-open");
  assert.equal(accepted.body.versionId, acceptedVersionId);
  const acceptedAssessment = JSON.parse(
    await readFile(
      join(acceptedRun.attemptPath, "candidate-assessment.json"),
      "utf8",
    ),
  );
  assert.equal(acceptedAssessment.status, "ready");
  assert.equal(
    (await readdir(
      join(opened.projectRoot, "versions"),
    )).filter((name) => /^ver_\d+$/.test(name)).length,
    expectedVersionIds.length,
  );
  const adopted = await bridge.postJson("/ready-version/activate", {
    sourcePath,
    projectId: accepted.body.projectId,
    documentId: accepted.body.documentId,
    requestId: accepted.body.requestId,
    attemptId: accepted.body.attemptId,
    versionId: accepted.body.versionId,
  });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.status, "version-activated");
  assert.deepEqual(
    (await readdir(join(opened.projectRoot, "versions")))
      .filter((name) => /^ver_\d+$/.test(name))
      .sort(),
    ["ver_0001", "ver_0002"],
  );
});
