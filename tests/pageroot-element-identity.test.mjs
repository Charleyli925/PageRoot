import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  PAGEROOT_ELEMENT_ID_SCHEMA_VERSION,
  PagerootElementIdentityError,
  buildSourceIndex,
  createTargetRef,
  generatePagerootElementId,
  isEphemeralPagerootAttribute,
  isPersistentPagerootAttribute,
  isValidPagerootElementId,
  resolveTargetRef,
} from "../app/lib/source-patch-core.js";

const ID_A = "pr1_11111111111141118111111111111111";
const ID_B = "pr1_22222222222242229222222222222222";
const ID_C = "pr1_3333333333334333a333333333333333";
const ID_D = "pr1_4444444444444444b444444444444444";
const ID_E = "pr1_55555555555545558555555555555555";
const ID_F = "pr1_66666666666646669666666666666666";

test("PageRoot element IDs use the versioned UUID v4 value contract", async () => {
  const generated = generatePagerootElementId(
    () => "01234567-89ab-4cde-8f01-23456789abcd",
  );
  assert.equal(generated, "pr1_0123456789ab4cde8f0123456789abcd");
  assert.equal(isValidPagerootElementId(generated), true);
  assert.equal(isValidPagerootElementId("pr1_0123456789ab3cde8f0123456789abcd"), false);
  assert.equal(isValidPagerootElementId("PR1_0123456789AB4CDE8F0123456789ABCD"), false);
  assert.throws(
    () => generatePagerootElementId(() => "not-a-uuid"),
    (error) => error instanceof PagerootElementIdentityError
      && error.code === "PAGEROOT_ID_GENERATOR_INVALID_OUTPUT",
  );
  assert.throws(
    () => generatePagerootElementId(null),
    (error) => error instanceof PagerootElementIdentityError
      && error.code === "PAGEROOT_ID_GENERATOR_UNAVAILABLE",
  );

  const schema = JSON.parse(await readFile(
    new URL("../schemas/pageroot-element-identity.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  assert.equal(validate(generated), true, ajv.errorsText(validate.errors));
  assert.equal(validate("pr1_0123456789ab3cde8f0123456789abcd"), false);
});

test("only data-pageroot-id is classified as a persistent PageRoot HTML attribute", () => {
  assert.equal(PAGEROOT_ELEMENT_ID_ATTRIBUTE, "data-pageroot-id");
  assert.equal(PAGEROOT_ELEMENT_ID_SCHEMA_VERSION, 1);
  assert.equal(isPersistentPagerootAttribute("DATA-PAGEROOT-ID"), true);
  assert.equal(isPersistentPagerootAttribute("data-pageroot-review-id"), false);
  assert.equal(isEphemeralPagerootAttribute("data-pageroot-review-id"), true);
  assert.equal(isEphemeralPagerootAttribute("data-pageroot-edit-runtime-host"), true);
  assert.equal(isEphemeralPagerootAttribute("data-pageroot-id"), false);
  assert.equal(isEphemeralPagerootAttribute("data-customer-id"), false);
});

test("SourceIndex resolves valid identities across HTML, SVG, template, and custom elements", () => {
  const html = `<!doctype html><html data-pageroot-id="${ID_A}"><body data-pageroot-id="${ID_B}"><svg data-pageroot-id="${ID_C}" viewBox="0 0 10 10"><rect data-pageroot-id="${ID_D}" width="10" height="10"></rect></svg><template data-pageroot-id="${ID_E}"><x-card data-pageroot-id="${ID_F}">内容</x-card></template></body></html>`;
  const index = buildSourceIndex(html);

  assert.equal(index.source, html);
  assert.equal(index.pagerootIdentity.status, "complete");
  assert.equal(index.pagerootIdentity.valid, true);
  assert.equal(index.pagerootIdentity.complete, true);
  assert.equal(index.pagerootIdentity.totalElementCount, 6);
  assert.equal(index.pagerootIdentity.identifiedElementCount, 6);
  assert.equal(index.pagerootIdentity.missingElementCount, 0);
  assert.equal(index.pagerootIdentity.invalidElementCount, 0);
  assert.deepEqual(index.pagerootIdentity.issues, []);
  assert.equal(index.byPagerootId.get(ID_D)?.tagName, "rect");
  assert.equal(index.byPagerootId.get(ID_F)?.tagName, "x-card");
  assert.deepEqual(index.byPagerootId.get(ID_F)?.pagerootIdAttribute.valueRange, {
    startOffset: html.indexOf(ID_F),
    endOffset: html.indexOf(ID_F) + ID_F.length,
  });
});

test("SourceIndex reports repeated, malformed, and conflicting identities without guessing", () => {
  const html = `<main data-pageroot-id="${ID_A}"><div data-pageroot-id="${ID_A}"></div><span data-pageroot-id="${ID_B.toUpperCase()}" data-pageroot-review-id="runtime"></span><i data-pageroot-id></i><b data-pageroot-id="${ID_C}" data-pageroot-id="${ID_D}"></b><u></u></main>`;
  const index = buildSourceIndex(html);

  assert.equal(index.source, html);
  assert.equal(index.pagerootIdentity.status, "invalid");
  assert.equal(index.pagerootIdentity.valid, false);
  assert.equal(index.pagerootIdentity.complete, false);
  assert.equal(index.pagerootIdentity.totalElementCount, 6);
  assert.equal(index.pagerootIdentity.identifiedElementCount, 0);
  assert.equal(index.pagerootIdentity.missingElementCount, 1);
  assert.equal(index.pagerootIdentity.invalidElementCount, 5);
  assert.deepEqual(
    index.pagerootIdentity.issues.map((issue) => issue.code).sort(),
    [
      "PAGEROOT_ID_ATTRIBUTE_REPEATED",
      "PAGEROOT_ID_DUPLICATE_VALUE",
      "PAGEROOT_ID_INVALID_FORMAT",
      "PAGEROOT_ID_INVALID_FORMAT",
    ],
  );
  assert.equal(index.byPagerootId.size, 0);
  const duplicate = index.elements.find(
    (element) => element.declaredPagerootId === ID_A,
  );
  assert.equal(duplicate?.pagerootId, null);
  assert.equal(duplicate?.stableAttributes[PAGEROOT_ELEMENT_ID_ATTRIBUTE], ID_A);
  assert.deepEqual(
    index.pagerootIdentity.issues.find(
      (issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE",
    )?.nodeIds.length,
    2,
  );
});

test("a valid value inside a repeated attribute group still blocks a conflicting lookup", () => {
  const html = `<main data-pageroot-id="${ID_A}" data-pageroot-id="${ID_B}"><section data-pageroot-id="${ID_A}"></section></main>`;
  const index = buildSourceIndex(html);

  assert.equal(index.byPagerootId.has(ID_A), false);
  assert.equal(index.byPagerootId.has(ID_B), false);
  assert.equal(index.elements[0].pagerootIdentityStatus, "invalid");
  assert.equal(index.elements[1].pagerootIdentityStatus, "duplicate");
  const conflict = index.pagerootIdentity.issues.find(
    (issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE",
  );
  assert.equal(conflict?.pagerootId, ID_A);
  assert.equal(conflict?.nodeIds.length, 2);
  assert.equal(conflict?.attributeRanges.length, 2);
});

test("legacy TargetRefs retain ephemeral PageRoot attributes as compatibility evidence", () => {
  const html = `<main><section data-pageroot-review-id="legacy-review"><h2>旧评论目标</h2></section></main>`;
  const baseIndex = buildSourceIndex(html);
  const section = baseIndex.elements.find((element) => element.tagName === "section");
  const legacyTargetRef = createTargetRef(baseIndex, section.nodeId);

  assert.equal(
    legacyTargetRef.fingerprint.stableAttributes["data-pageroot-review-id"],
    "legacy-review",
  );
  assert.match(legacyTargetRef.selector, /data-pageroot-review-id/u);
  const shifted = resolveTargetRef(buildSourceIndex(`<!-- shift -->${html}`), legacyTargetRef);
  assert.equal(shifted.resolution, "orphaned");
  assert.equal(shifted.reason, "pageroot-identity-incomplete");
});

test("stable TargetRefs follow one element across text and position changes without guessing", () => {
  const base = `<main data-pageroot-id="${ID_A}"><section data-pageroot-id="${ID_B}">原始文字</section><section data-pageroot-id="${ID_C}">同类兄弟</section></main>`;
  const baseIndex = buildSourceIndex(base);
  const target = createTargetRef(baseIndex, baseIndex.byPagerootId.get(ID_B));

  assert.equal(target.elementId, ID_B);
  assert.equal(target.expectedSourceSha256, baseIndex.sourceSha256);
  assert.deepEqual(
    Object.keys(target).filter((key) => key === "elementId" || key === "expectedSourceSha256"),
    ["elementId", "expectedSourceSha256"],
  );

  const moved = `<main data-pageroot-id="${ID_A}"><section data-pageroot-id="${ID_D}">同类兄弟</section><section data-pageroot-id="${ID_C}">同类兄弟</section><section data-pageroot-id="${ID_B}">已经改字</section></main>`;
  const resolved = resolveTargetRef(buildSourceIndex(moved), target);
  assert.equal(resolved.resolution, "exact");
  assert.equal(resolved.reason, "stable-element-match");
  assert.equal(resolved.target?.pagerootId, ID_B);
  assert.equal(resolved.target?.textContent, "已经改字");

  const replacement = `<main data-pageroot-id="${ID_A}"><section data-pageroot-id="${ID_D}">原始文字</section><section data-pageroot-id="${ID_C}">同类兄弟</section></main>`;
  const deleted = resolveTargetRef(buildSourceIndex(replacement), target);
  assert.equal(deleted.resolution, "orphaned");
  assert.equal(deleted.reason, "stable-element-not-found");

  const wrongMigration = `<main data-pageroot-id="${ID_A}"><article data-pageroot-id="${ID_B}">原始文字</article><section data-pageroot-id="${ID_C}">同类兄弟</section></main>`;
  const mismatched = resolveTargetRef(buildSourceIndex(wrongMigration), target);
  assert.equal(mismatched.resolution, "exact");
  assert.equal(mismatched.reason, "stable-element-match");
  assert.equal(mismatched.target?.pagerootId, ID_B);
  assert.equal(mismatched.target?.tagName, "article");

  const missingTagEvidence = structuredClone(target);
  delete missingTagEvidence.fingerprint;
  const unproven = resolveTargetRef(baseIndex, missingTagEvidence);
  assert.equal(unproven.resolution, "exact");
  assert.equal(unproven.target?.pagerootId, ID_B);
  assert.equal(unproven.reason, "stable-element-and-source-hash-match");
});

test("legacy HTML remains byte-for-byte untouched and is reported as identity-absent", () => {
  const html = "<!doctype html>\r\n<main><h1>旧项目 😀</h1><input disabled></main>";
  const index = buildSourceIndex(html);
  assert.equal(index.source, html);
  assert.equal(index.source.includes(PAGEROOT_ELEMENT_ID_ATTRIBUTE), false);
  assert.equal(index.pagerootIdentity.status, "absent");
  assert.equal(index.pagerootIdentity.valid, true);
  assert.equal(index.pagerootIdentity.complete, false);
  assert.equal(index.pagerootIdentity.identifiedElementCount, 0);
  assert.equal(index.pagerootIdentity.missingElementCount, index.elements.length);
  assert.equal(index.byPagerootId.size, 0);
});
