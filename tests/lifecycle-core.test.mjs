import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICALIZATION_VERSION,
  MANAGED_META_NAMES,
  comparisonSha256,
  findUnexpectedAttemptEntry,
  findUnexpectedAttemptOutputEntry,
  injectManagedMeta,
  sha256,
  stripManagedMeta,
} from "../scripts/lifecycle-core.mjs";

function directoryEntry(name, kind = "file") {
  return {
    name,
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symlink",
  };
}

test("Attempt surfaces ignore only regular Finder metadata", () => {
  assert.equal(
    findUnexpectedAttemptEntry([directoryEntry(".DS_Store")]),
    undefined,
  );
  assert.equal(
    findUnexpectedAttemptOutputEntry([
      directoryEntry("index.html"),
      directoryEntry(".DS_Store"),
    ]),
    undefined,
  );
  assert.equal(
    findUnexpectedAttemptEntry([
      directoryEntry(".DS_Store", "symlink"),
    ])?.name,
    ".DS_Store",
  );
  assert.equal(
    findUnexpectedAttemptEntry([directoryEntry(".hidden")])?.name,
    ".hidden",
  );
  assert.equal(
    findUnexpectedAttemptOutputEntry([
      directoryEntry("index.html"),
      directoryEntry("extra.html"),
    ])?.name,
    "extra.html",
  );
});

const base = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="html-ai-custom-note" content="must-stay">
  <title>指标</title>
</head>
<body><main><h1>指标</h1></main></body>
</html>`;

test("canonical comparison removes only the five exact lifecycle meta tags", () => {
  const stamped = injectManagedMeta(base, {
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0009",
    versionLabel: "V9",
    basedOnVersionId: "ver_0008",
    requestId: "req_0009",
  });
  assert.equal(CANONICALIZATION_VERSION, "1");
  assert.equal(MANAGED_META_NAMES.length, 5);
  for (const name of MANAGED_META_NAMES) {
    assert.match(stamped, new RegExp(`name="${name}"`));
  }
  assert.match(stamped, /html-ai-custom-note/);
  assert.equal(comparisonSha256(stamped), comparisonSha256(base));
  assert.equal(stripManagedMeta(stamped).includes("html-ai-version-id"), false);
  assert.equal(stripManagedMeta(stamped).includes("html-ai-custom-note"), true);
});

test("ordinary whitespace, CSS and body changes remain meaningful", () => {
  assert.notEqual(comparisonSha256(base), comparisonSha256(base.replace("<h1>", "<h1> ")));
  assert.notEqual(
    comparisonSha256(base),
    comparisonSha256(base.replace("</head>", "<style>h1{color:red}</style></head>")),
  );
  assert.notEqual(
    comparisonSha256(base),
    comparisonSha256(base.replace("指标</h1>", "核心指标</h1>")),
  );
});

test("authoritative stamping replaces stale identity without broad metadata deletion", () => {
  const stale = injectManagedMeta(base, {
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0008",
    versionLabel: "V8",
    basedOnVersionId: "ver_0007",
    requestId: "req_0008",
  });
  const final = injectManagedMeta(stale, {
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0009",
    versionLabel: "V9",
    basedOnVersionId: "ver_0008",
    requestId: "req_0009",
  });
  assert.doesNotMatch(final, /content="ver_0007"|content="req_0008"|content="V8"/);
  assert.match(final, /content="ver_0009"/);
  assert.match(final, /content="req_0009"/);
  assert.match(final, /html-ai-custom-note/);
  assert.match(sha256(final), /^sha256:[a-f0-9]{64}$/);
});

test("canonical parsing ignores tag-shaped strings in scripts and comments", () => {
  const tricky = base.replace(
    "<title>指标</title>",
    `<script>
const fakeMeta = '<meta name="html-ai-version-id" content="ver_9999">';
const fakeHead = "</head>";
</script>
<!-- <meta name="html-ai-request-id" content="req_9999"> -->
<meta content="ver_0008>quoted" name="html-ai-version-id">
<title>指标</title>`,
  );
  const stripped = stripManagedMeta(tricky);
  assert.match(stripped, /fakeMeta = '<meta name="html-ai-version-id"/);
  assert.match(stripped, /<!-- <meta name="html-ai-request-id"/);
  assert.doesNotMatch(stripped, /content="ver_0008>quoted"/);

  const stamped = injectManagedMeta(tricky, {
    documentId: "doc_0123456789abcdef",
    versionId: "ver_0009",
    versionLabel: "V9",
    basedOnVersionId: "ver_0008",
    requestId: "req_0009",
  });
  assert.ok(
    stamped.indexOf('name="html-ai-document-id"')
      > stamped.indexOf("</script>"),
  );
  assert.ok(
    stamped.indexOf('name="html-ai-request-id" content="req_0009"')
      < stamped.lastIndexOf("</head>"),
  );
});

test("template metadata is canonicalized without matching script templates", () => {
  const withTemplates = base.replace(
    "</body>",
    `<template id="identity-fragment">
  <meta name="html-ai-version-label" content="V8">
</template>
<script>const template = \`<meta name="html-ai-version-label" content="V7">\`;</script>
</body>`,
  );
  const first = stripManagedMeta(withTemplates);
  const second = stripManagedMeta(first);
  assert.equal(first, second);
  assert.match(first, /<template id="identity-fragment">/);
  assert.doesNotMatch(first, /content="V8"/);
  assert.match(first, /content="V7"/);
  assert.notEqual(comparisonSha256(withTemplates), comparisonSha256(base));
});
