import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  STEMMIO_ELEMENT_ID_ATTRIBUTE,
  STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
  StemmioElementIdentityError,
  buildSourceIndex,
  createTargetRef,
  generateStemmioElementId,
  isEphemeralStemmioAttribute,
  isPersistentStemmioAttribute,
  isValidStemmioElementId,
  resolveTargetRef,
} from "../app/lib/source-patch-core.js";

const ID_A = "sm1_11111111111141118111111111111111";
const ID_B = "sm1_22222222222242229222222222222222";
const ID_C = "sm1_3333333333334333a333333333333333";
const ID_D = "sm1_4444444444444444b444444444444444";
const ID_E = "sm1_55555555555545558555555555555555";
const ID_F = "sm1_66666666666646669666666666666666";

test("Stemmio element IDs use the versioned UUID v4 value contract", async () => {
  const generated = generateStemmioElementId(
    () => "01234567-89ab-4cde-8f01-23456789abcd",
  );
  assert.equal(generated, "sm1_0123456789ab4cde8f0123456789abcd");
  assert.equal(isValidStemmioElementId(generated), true);
  assert.equal(isValidStemmioElementId("sm1_0123456789ab3cde8f0123456789abcd"), false);
  assert.equal(isValidStemmioElementId("PR1_0123456789AB4CDE8F0123456789ABCD"), false);
  assert.throws(
    () => generateStemmioElementId(() => "not-a-uuid"),
    (error) => error instanceof StemmioElementIdentityError
      && error.code === "STEMMIO_ID_GENERATOR_INVALID_OUTPUT",
  );
  assert.throws(
    () => generateStemmioElementId(null),
    (error) => error instanceof StemmioElementIdentityError
      && error.code === "STEMMIO_ID_GENERATOR_UNAVAILABLE",
  );

  const schema = JSON.parse(await readFile(
    new URL("../schemas/stemmio-element-identity.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  assert.equal(validate(generated), true, ajv.errorsText(validate.errors));
  assert.equal(validate("sm1_0123456789ab3cde8f0123456789abcd"), false);
});

test("only data-stemmio-id is classified as a persistent Stemmio HTML attribute", () => {
  assert.equal(STEMMIO_ELEMENT_ID_ATTRIBUTE, "data-stemmio-id");
  assert.equal(STEMMIO_ELEMENT_ID_SCHEMA_VERSION, 1);
  assert.equal(isPersistentStemmioAttribute("DATA-STEMMIO-ID"), true);
  assert.equal(isPersistentStemmioAttribute("data-stemmio-review-id"), false);
  assert.equal(isEphemeralStemmioAttribute("data-stemmio-review-id"), true);
  assert.equal(isEphemeralStemmioAttribute("data-stemmio-edit-runtime-host"), true);
  assert.equal(isEphemeralStemmioAttribute("data-stemmio-id"), false);
  assert.equal(isEphemeralStemmioAttribute("data-customer-id"), false);
});

test("SourceIndex resolves valid identities across HTML, SVG, template, and custom elements", () => {
  const html = `<!doctype html><html data-stemmio-id="${ID_A}"><body data-stemmio-id="${ID_B}"><svg data-stemmio-id="${ID_C}" viewBox="0 0 10 10"><rect data-stemmio-id="${ID_D}" width="10" height="10"></rect></svg><template data-stemmio-id="${ID_E}"><x-card data-stemmio-id="${ID_F}">内容</x-card></template></body></html>`;
  const index = buildSourceIndex(html);

  assert.equal(index.source, html);
  assert.equal(index.stemmioIdentity.status, "complete");
  assert.equal(index.stemmioIdentity.valid, true);
  assert.equal(index.stemmioIdentity.complete, true);
  assert.equal(index.stemmioIdentity.totalElementCount, 6);
  assert.equal(index.stemmioIdentity.identifiedElementCount, 6);
  assert.equal(index.stemmioIdentity.missingElementCount, 0);
  assert.equal(index.stemmioIdentity.invalidElementCount, 0);
  assert.deepEqual(index.stemmioIdentity.issues, []);
  assert.equal(index.byStemmioId.get(ID_D)?.tagName, "rect");
  assert.equal(index.byStemmioId.get(ID_F)?.tagName, "x-card");
  assert.deepEqual(index.byStemmioId.get(ID_F)?.stemmioIdAttribute.valueRange, {
    startOffset: html.indexOf(ID_F),
    endOffset: html.indexOf(ID_F) + ID_F.length,
  });
});

test("SourceIndex reports repeated, malformed, and conflicting identities without guessing", () => {
  const html = `<main data-stemmio-id="${ID_A}"><div data-stemmio-id="${ID_A}"></div><span data-stemmio-id="${ID_B.toUpperCase()}" data-stemmio-review-id="runtime"></span><i data-stemmio-id></i><b data-stemmio-id="${ID_C}" data-stemmio-id="${ID_D}"></b><u></u></main>`;
  const index = buildSourceIndex(html);

  assert.equal(index.source, html);
  assert.equal(index.stemmioIdentity.status, "invalid");
  assert.equal(index.stemmioIdentity.valid, false);
  assert.equal(index.stemmioIdentity.complete, false);
  assert.equal(index.stemmioIdentity.totalElementCount, 6);
  assert.equal(index.stemmioIdentity.identifiedElementCount, 0);
  assert.equal(index.stemmioIdentity.missingElementCount, 1);
  assert.equal(index.stemmioIdentity.invalidElementCount, 5);
  assert.deepEqual(
    index.stemmioIdentity.issues.map((issue) => issue.code).sort(),
    [
      "STEMMIO_ID_ATTRIBUTE_REPEATED",
      "STEMMIO_ID_DUPLICATE_VALUE",
      "STEMMIO_ID_INVALID_FORMAT",
      "STEMMIO_ID_INVALID_FORMAT",
    ],
  );
  assert.equal(index.byStemmioId.size, 0);
  const duplicate = index.elements.find(
    (element) => element.declaredStemmioId === ID_A,
  );
  assert.equal(duplicate?.stemmioId, null);
  assert.equal(duplicate?.stableAttributes[STEMMIO_ELEMENT_ID_ATTRIBUTE], ID_A);
  assert.deepEqual(
    index.stemmioIdentity.issues.find(
      (issue) => issue.code === "STEMMIO_ID_DUPLICATE_VALUE",
    )?.nodeIds.length,
    2,
  );
});

test("a valid value inside a repeated attribute group still blocks a conflicting lookup", () => {
  const html = `<main data-stemmio-id="${ID_A}" data-stemmio-id="${ID_B}"><section data-stemmio-id="${ID_A}"></section></main>`;
  const index = buildSourceIndex(html);

  assert.equal(index.byStemmioId.has(ID_A), false);
  assert.equal(index.byStemmioId.has(ID_B), false);
  assert.equal(index.elements[0].stemmioIdentityStatus, "invalid");
  assert.equal(index.elements[1].stemmioIdentityStatus, "duplicate");
  const conflict = index.stemmioIdentity.issues.find(
    (issue) => issue.code === "STEMMIO_ID_DUPLICATE_VALUE",
  );
  assert.equal(conflict?.stemmioId, ID_A);
  assert.equal(conflict?.nodeIds.length, 2);
  assert.equal(conflict?.attributeRanges.length, 2);
});

test("legacy TargetRefs retain ephemeral Stemmio attributes as compatibility evidence", () => {
  const html = `<main><section data-stemmio-review-id="legacy-review"><h2>旧评论目标</h2></section></main>`;
  const baseIndex = buildSourceIndex(html);
  const section = baseIndex.elements.find((element) => element.tagName === "section");
  const legacyTargetRef = createTargetRef(baseIndex, section.nodeId);

  assert.equal(
    legacyTargetRef.fingerprint.stableAttributes["data-stemmio-review-id"],
    "legacy-review",
  );
  assert.match(legacyTargetRef.selector, /data-stemmio-review-id/u);
  const shifted = resolveTargetRef(buildSourceIndex(`<!-- shift -->${html}`), legacyTargetRef);
  assert.equal(shifted.resolution, "orphaned");
  assert.equal(shifted.reason, "managed-element-id-required");
});

test("stable TargetRefs follow one element across text and position changes without guessing", () => {
  const base = `<main data-stemmio-id="${ID_A}"><section data-stemmio-id="${ID_B}">原始文字</section><section data-stemmio-id="${ID_C}">同类兄弟</section></main>`;
  const baseIndex = buildSourceIndex(base);
  const target = createTargetRef(baseIndex, baseIndex.byStemmioId.get(ID_B));

  assert.equal(target.elementId, ID_B);
  assert.equal(target.expectedSourceSha256, baseIndex.sourceSha256);
  assert.deepEqual(
    Object.keys(target).filter((key) => key === "elementId" || key === "expectedSourceSha256"),
    ["elementId", "expectedSourceSha256"],
  );

  const moved = `<main data-stemmio-id="${ID_A}"><section data-stemmio-id="${ID_D}">同类兄弟</section><section data-stemmio-id="${ID_C}">同类兄弟</section><section data-stemmio-id="${ID_B}">已经改字</section></main>`;
  const resolved = resolveTargetRef(buildSourceIndex(moved), target);
  assert.equal(resolved.resolution, "exact");
  assert.equal(resolved.reason, "stable-element-match");
  assert.equal(resolved.target?.stemmioId, ID_B);
  assert.equal(resolved.target?.textContent, "已经改字");

  const replacement = `<main data-stemmio-id="${ID_A}"><section data-stemmio-id="${ID_D}">原始文字</section><section data-stemmio-id="${ID_C}">同类兄弟</section></main>`;
  const deleted = resolveTargetRef(buildSourceIndex(replacement), target);
  assert.equal(deleted.resolution, "orphaned");
  assert.equal(deleted.reason, "stable-element-not-found");

  const wrongMigration = `<main data-stemmio-id="${ID_A}"><article data-stemmio-id="${ID_B}">原始文字</article><section data-stemmio-id="${ID_C}">同类兄弟</section></main>`;
  const mismatched = resolveTargetRef(buildSourceIndex(wrongMigration), target);
  assert.equal(mismatched.resolution, "exact");
  assert.equal(mismatched.reason, "stable-element-match");
  assert.equal(mismatched.target?.stemmioId, ID_B);
  assert.equal(mismatched.target?.tagName, "article");

  const missingTagEvidence = structuredClone(target);
  delete missingTagEvidence.fingerprint;
  const unproven = resolveTargetRef(baseIndex, missingTagEvidence);
  assert.equal(unproven.resolution, "exact");
  assert.equal(unproven.target?.stemmioId, ID_B);
  assert.equal(unproven.reason, "stable-element-and-source-hash-match");
});

test("legacy HTML remains byte-for-byte untouched and is reported as identity-absent", () => {
  const html = "<!doctype html>\r\n<main><h1>旧项目 😀</h1><input disabled></main>";
  const index = buildSourceIndex(html);
  assert.equal(index.source, html);
  assert.equal(index.source.includes(STEMMIO_ELEMENT_ID_ATTRIBUTE), false);
  assert.equal(index.stemmioIdentity.status, "absent");
  assert.equal(index.stemmioIdentity.valid, true);
  assert.equal(index.stemmioIdentity.complete, false);
  assert.equal(index.stemmioIdentity.identifiedElementCount, 0);
  assert.equal(index.stemmioIdentity.missingElementCount, index.elements.length);
  assert.equal(index.byStemmioId.size, 0);
});
