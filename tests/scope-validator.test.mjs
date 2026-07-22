import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import Ajv2020 from "../node_modules/schema-utils/node_modules/ajv/dist/2020.js";

import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  createInsertionPointTargetRef,
  createTargetRef,
} from "../app/lib/target-resolver.js";
import { injectManagedMeta, sha256 } from "../scripts/lifecycle-core.mjs";
import { validateScope } from "../scripts/scope-validator.mjs";

const execFileAsync = promisify(execFile);
const productRoot = fileURLToPath(new URL("../", import.meta.url));
const bridgeScript = join(productRoot, "scripts", "workspace-bridge.mjs");
const finalizerScript = join(productRoot, "scripts", "finalize-attempt.mjs");

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
      join(productRoot, "..", "schemas", "scope-report.v1.schema.json"),
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

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

async function requestJson(baseUrl, pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { response, body: await response.json() };
}

async function postJson(baseUrl, pathname, body) {
  return requestJson(baseUrl, pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timedOut = await Promise.race([
    exited.then(() => false),
    delay(2_000).then(() => true),
  ]);
  if (timedOut && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function startBridge(workspace) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = { stdout: "", stderr: "" };
  const child = spawn(process.execPath, [bridgeScript], {
    cwd: productRoot,
    env: {
      ...process.env,
      HTML_AI_WORKSPACE: workspace,
      HTML_AI_BRIDGE_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    logs.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs.stderr += chunk;
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Bridge exited with ${child.exitCode}\n${logs.stdout}\n${logs.stderr}`,
      );
    }
    try {
      const health = await requestJson(baseUrl, "/health");
      if (health.response.status === 200) {
        return { child, baseUrl, logs };
      }
    } catch {
      // Keep polling until the bounded deadline.
    }
    await delay(30);
  }
  throw new Error(`Bridge health timeout\n${logs.stdout}\n${logs.stderr}`);
}

async function runFinalizer(workspace, run) {
  await execFileAsync(process.execPath, [
    finalizerScript,
    "--workspace",
    workspace,
    "--project-id",
    run.projectId,
    "--request-id",
    run.requestId,
    "--attempt-id",
    run.attemptId,
  ]);
}

test("workspace lifecycle keeps text scope exact and hard-blocks identity or script widening", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "html-ai-text-scope-"));
  const workspace = join(root, "workspace");
  const sources = join(root, "sources");
  await mkdir(workspace);
  await mkdir(sources);
  const sourcePath = join(sources, "text-scope.html");
  await writeFile(sourcePath, documentHtml(), "utf8");
  const bridge = await startBridge(workspace);
  t.after(async () => {
    await stopChild(bridge.child);
    await rm(root, { recursive: true, force: true });
  });

  const preview = (
    await requestJson(
      bridge.baseUrl,
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    )
  ).body;
  assert.equal(preview.registered, false);
  const opened = (
    await postJson(bridge.baseUrl, "/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.currentHtmlSha256,
    })
  ).body;
  assert.equal(opened.registered, true);
  const frozenSource = await readFile(sourcePath, "utf8");
  const target = textTarget(frozenSource);
  const rejectedCases = [
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
        '<p id="inside" id="shadow">',
      ),
    ],
    [
      "structure",
      (html) => html.replace("目标正文", "<strong>目标正文</strong>"),
    ],
  ];

  let hardCaseCount = 0;
  let softCaseCount = 0;
  for (const [expectedKind, mutate] of rejectedCases) {
    const run = (
      await postJson(bridge.baseUrl, "/request", {
        sourcePath,
        projectId: opened.projectId,
        documentId: opened.documentId,
        expectedSourceSha256: opened.currentHtmlSha256,
        freezeCutoffRevision: 0,
        summary: `拒绝 text scope ${expectedKind} widening`,
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
    assert.equal(run.candidateVersionId, "ver_0002");
    const base = await readFile(run.inputPath, "utf8");
    await writeFile(run.outputPath, mutate(base), "utf8");
    await runFinalizer(workspace, run);
    const status = await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    if (status.body.status === "error") {
      hardCaseCount += 1;
      assert.equal(status.body.error.code, "HARD_VALIDATION_FAILED");
      assert.ok(status.body.error.details.hardViolationCodes.length > 0);
    } else {
      softCaseCount += 1;
      assert.equal(status.body.status, "awaiting-check-decision");
      assert.equal(status.body.validationReview.status, "pending");
      assert.deepEqual(status.body.validationReview.hardViolationCodes, []);
      const cancelled = await postJson(
        bridge.baseUrl,
        "/active-run/cancel",
        {
          sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
        },
      );
      assert.equal(cancelled.response.status, 200);
      assert.equal(cancelled.body.status, "cancelled");
    }
    assert.ok(
      status.body.scopeReport.differences.some(
        (difference) =>
          difference.kind === expectedKind
          && difference.classification === "target-outside",
      ),
      expectedKind,
    );
    assert.equal(await readFile(sourcePath, "utf8"), frozenSource);
  }
  assert.ok(hardCaseCount > 0, "at least one identity/security widening must hard-fail");
  assert.ok(softCaseCount > 0, "reviewable breadth findings must require a user decision");

  const acceptedRun = (
    await postJson(bridge.baseUrl, "/request", {
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
  assert.equal(acceptedRun.candidateVersionId, "ver_0002");
  const acceptedBase = await readFile(acceptedRun.inputPath, "utf8");
  await writeFile(
    acceptedRun.outputPath,
    acceptedBase.replace("目标正文", "目标正文已更新"),
    "utf8",
  );
  await runFinalizer(workspace, acceptedRun);
  const accepted = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${acceptedRun.requestId}&attemptId=${acceptedRun.attemptId}`,
  );
  assert.equal(accepted.body.status, "ready-to-open");
  assert.equal(accepted.body.versionId, "ver_0002");
});

test("a soft scope finding requires an audited waiver before the Version becomes ready", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "html-ai-soft-scope-waiver-"));
  const workspace = join(root, "workspace");
  const sources = join(root, "sources");
  await mkdir(workspace);
  await mkdir(sources);
  const sourcePath = join(sources, "soft-scope.html");
  const originalHtml = documentHtml();
  await writeFile(sourcePath, originalHtml, "utf8");
  const bridge = await startBridge(workspace);
  t.after(async () => {
    await stopChild(bridge.child);
    await rm(root, { recursive: true, force: true });
  });

  const preview = (
    await requestJson(
      bridge.baseUrl,
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    )
  ).body;
  const opened = (
    await postJson(bridge.baseUrl, "/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.currentHtmlSha256,
    })
  ).body;
  const target = regularTarget();
  const run = (
    await postJson(bridge.baseUrl, "/request", {
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
  await writeFile(
    run.outputPath,
    frozenHtml.replace("目标外正文", "用户确认保留的范围外调整"),
    "utf8",
  );
  await runFinalizer(workspace, run);

  const pending = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(pending.response.status, 200);
  assert.equal(pending.body.status, "awaiting-check-decision");
  assert.equal(pending.body.validationReview.status, "pending");
  assert.deepEqual(pending.body.validationReview.hardViolationCodes, []);
  assert.ok(pending.body.validationReview.softViolationCodes.length > 0);
  assert.equal(await readFile(sourcePath, "utf8"), originalHtml);

  const wrongWaiver = await postJson(
    bridge.baseUrl,
    "/validation/waive",
    {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      requestId: run.requestId,
      attemptId: run.attemptId,
      violationCodes: ["SOME_OTHER_FINDING"],
    },
  );
  assert.equal(wrongWaiver.response.status, 409);
  assert.equal(wrongWaiver.body.error.code, "VALIDATION_WAIVER_SCOPE_MISMATCH");

  const waived = await postJson(
    bridge.baseUrl,
    "/validation/waive",
    {
      sourcePath,
      projectId: opened.projectId,
      documentId: opened.documentId,
      requestId: run.requestId,
      attemptId: run.attemptId,
      violationCodes: pending.body.validationReview.softViolationCodes,
      reason: "用户点击无视本校验，继续。",
    },
  );
  assert.equal(waived.response.status, 200, JSON.stringify(waived.body));
  assert.equal(waived.body.status, "validation-waived");
  assert.equal(waived.body.validationReview.status, "waived");
  assert.equal(
    waived.body.validationReview.waiver.decision,
    "ignore-and-continue",
  );

  const ready = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
  );
  assert.equal(ready.response.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.status, "ready-to-open");
  assert.equal(ready.body.validationReview.status, "waived");
  assert.equal(ready.body.versionId, "ver_0002");
  assert.equal(ready.body.currentPath, sourcePath);
  assert.notEqual(ready.body.workingCopyPath, sourcePath);
  assert.equal(await readFile(sourcePath, "utf8"), originalHtml);

  const persistedReview = JSON.parse(
    await readFile(join(run.attemptPath, "validation-review.json"), "utf8"),
  );
  assert.equal(persistedReview.status, "waived");
  assert.equal(persistedReview.waiver.reason, "用户点击无视本校验，继续。");
});

test("workspace lifecycle surfaces soft scope classes for a user decision and reuses a cancelled candidate", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "html-ai-scope-lifecycle-"));
  const workspace = join(root, "workspace");
  const sources = join(root, "sources");
  await mkdir(workspace);
  await mkdir(sources);
  const sourcePath = join(sources, "scope.html");
  await writeFile(sourcePath, documentHtml(), "utf8");
  const bridge = await startBridge(workspace);
  t.after(async () => {
    await stopChild(bridge.child);
    await rm(root, { recursive: true, force: true });
  });

  const preview = (
    await requestJson(
      bridge.baseUrl,
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    )
  ).body;
  assert.equal(preview.registered, false);
  const opened = (
    await postJson(bridge.baseUrl, "/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.currentHtmlSha256,
    })
  ).body;
  assert.equal(opened.registered, true);
  const target = regularTarget();
  const violations = [
    ["text", false, (html) => html.replace("目标外正文", "越界正文")],
    [
      "attribute",
      false,
      (html) =>
        html.replace(
          '<aside id="outside">',
          '<aside id="outside" data-rogue="true">',
        ),
    ],
    [
      "structure",
      false,
      (html) =>
        html.replace(
          '<aside id="outside">',
          '<section id="rogue">越界结构</section><aside id="outside">',
        ),
    ],
    ["shared-css", false, (html) => html.replace("color: red", "color: blue")],
    [
      "script",
      true,
      (html) =>
        html.replace("window.scopeFixture = 1", "window.scopeFixture = 2"),
    ],
  ];

  let expectedSourceSha256 = opened.currentHtmlSha256;
  for (const [expectedKind, hardFailure, mutate] of violations) {
    const run = (
      await postJson(bridge.baseUrl, "/request", {
        sourcePath,
        projectId: opened.projectId,
        documentId: opened.documentId,
        expectedSourceSha256,
        freezeCutoffRevision: 0,
        summary: `拒绝目标外 ${expectedKind}`,
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
    assert.equal(run.candidateVersionId, "ver_0002", expectedKind);
    const frozenHtml = await readFile(run.inputPath, "utf8");
    await writeFile(run.outputPath, mutate(frozenHtml), "utf8");
    await runFinalizer(workspace, run);
    const status = await requestJson(
      bridge.baseUrl,
      `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${run.requestId}&attemptId=${run.attemptId}`,
    );
    assert.equal(status.response.status, 200, expectedKind);
    assert.equal(
      status.body.status,
      hardFailure ? "error" : "awaiting-check-decision",
      expectedKind,
    );
    if (hardFailure) {
      assert.equal(status.body.error.code, "HARD_VALIDATION_FAILED");
      assert.ok(status.body.error.details.hardViolationCodes.length > 0);
    } else {
      assert.equal(status.body.validationReview.status, "pending", expectedKind);
      assert.deepEqual(
        status.body.validationReview.hardViolationCodes,
        [],
        expectedKind,
      );
      assert.ok(
        status.body.validationReview.softViolationCodes.length > 0,
        expectedKind,
      );
    }
    assert.equal(status.body.scopeReport.verdict, "fail", expectedKind);
    assert.ok(
      status.body.scopeReport.differences.some(
        (difference) =>
          difference.kind === expectedKind
          && difference.classification === "target-outside",
      ),
      expectedKind,
    );

    const scopeReportPath = join(run.attemptPath, "scope-report.json");
    const validationReviewPath = join(
      run.attemptPath,
      "validation-review.json",
    );
    const outcomePath = join(run.attemptPath, "outcome.json");
    await Promise.all([
      access(run.outputPath),
      access(run.completionPath),
      access(scopeReportPath),
      ...(hardFailure ? [access(outcomePath)] : [access(validationReviewPath)]),
    ]);
    const persistedReport = JSON.parse(
      await readFile(scopeReportPath, "utf8"),
    );
    if (!hardFailure) {
      const persistedReview = JSON.parse(
        await readFile(validationReviewPath, "utf8"),
      );
      assert.equal(persistedReview.status, "pending", expectedKind);
      const cancelled = await postJson(
        bridge.baseUrl,
        "/active-run/cancel",
        {
          sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
        },
      );
      assert.equal(cancelled.response.status, 200, expectedKind);
      assert.equal(cancelled.body.status, "cancelled", expectedKind);
    }
    const persistedOutcome = JSON.parse(
      await readFile(outcomePath, "utf8"),
    );
    assert.equal(persistedReport.verdict, "fail", expectedKind);
    assert.equal(
      persistedOutcome.status,
      hardFailure ? "failed" : "cancelled",
      expectedKind,
    );
    if (hardFailure) {
      assert.equal(
        persistedOutcome.error.code,
        "HARD_VALIDATION_FAILED",
        expectedKind,
      );
    }
    const projectRoot = join(
      workspace,
      "projects",
      opened.projectId,
    );
    const versionIds = (await readdir(join(projectRoot, "versions")))
      .filter((name) => /^ver_\d+$/.test(name));
    assert.deepEqual(versionIds, ["ver_0001"], expectedKind);
    const transactionEntries = await readdir(
      join(projectRoot, "transactions"),
    );
    assert.deepEqual(transactionEntries, [], expectedKind);
    const runtime = JSON.parse(
      await readFile(join(projectRoot, "runtime-state.json"), "utf8"),
    );
    assert.equal(runtime.lifecycleState, "editing", expectedKind);
    assert.equal(runtime.activeRun, null, expectedKind);
    assert.equal(await readFile(sourcePath, "utf8"), frozenHtml, expectedKind);
    expectedSourceSha256 = sha256(await readFile(sourcePath));
  }

  const acceptedRun = (
    await postJson(bridge.baseUrl, "/request", {
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
  assert.equal(acceptedRun.candidateVersionId, "ver_0002");
  const acceptedBase = await readFile(acceptedRun.inputPath, "utf8");
  await writeFile(
    acceptedRun.outputPath,
    acceptedBase.replace("目标正文", "目标正文已更新"),
    "utf8",
  );
  await runFinalizer(workspace, acceptedRun);
  const accepted = await requestJson(
    bridge.baseUrl,
    `/status?sourcePath=${encodeURIComponent(sourcePath)}&requestId=${acceptedRun.requestId}&attemptId=${acceptedRun.attemptId}`,
  );
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.status, "ready-to-open");
  assert.equal(accepted.body.versionId, "ver_0002");
  const acceptedReport = JSON.parse(
    await readFile(
      join(acceptedRun.attemptPath, "scope-report.json"),
      "utf8",
    ),
  );
  assert.equal(acceptedReport.verdict, "pass");
  assert.equal(acceptedReport.summary.violationCount, 0);
  assert.ok(
    acceptedReport.differences.some(
      (difference) =>
        difference.kind === "finalizer-metadata"
        && difference.allowed
        && !difference.material,
    ),
  );
  assert.equal(
    (await readdir(
      join(workspace, "projects", opened.projectId, "versions"),
    )).filter((name) => /^ver_\d+$/.test(name)).length,
    2,
  );
});
