import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "../node_modules/schema-utils/node_modules/ajv/dist/2020.js";

const MAIN_SCHEMA_VERSION = "3.0.0";

function validator() {
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
  return ajv;
}

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

const pairs = [
  ["annotation-records.v3.schema.json", "annotation-records.frozen.json"],
  ["change-request.v3.schema.json", "change-request.frozen.json"],
  ["project-state.v3.schema.json", "project-state.current-edited.json"],
  ["project-state.v3.schema.json", "project-state.current-version.json"],
  ["runtime-state.v3.schema.json", "runtime-state.autosave-pending.json"],
  ["runtime-state.v3.schema.json", "runtime-state.autosave-conflict.json"],
  [
    "runtime-state.v3.schema.json",
    "runtime-state.awaiting-conflict-resolution.json",
  ],
  ["runtime-state.v3.schema.json", "runtime-state.processing.json"],
  ["runtime-state.v3.schema.json", "runtime-state.ready.json"],
  ["runtime-state.v3.schema.json", "runtime-state.submitting.json"],
  ["source-history.v1.schema.json", "source-history.current.json"],
  [
    "runtime-state.v3.schema.json",
    "runtime-state.recovering-transaction.json",
  ],
  ["version-manifest.v3.schema.json", "version-manifest.initial.json"],
  [
    "version-manifest.v3.schema.json",
    "version-manifest.internal-ai.json",
  ],
  ["scope-report.v1.schema.json", "scope-report.pass.json"],
];

test("the clean targeted-change workspace uses strict v3 main records", async () => {
  for (const [schemaName, fixtureName] of pairs) {
    const ajv = validator();
    const schema = await json(
      new URL(`../schemas/${schemaName}`, import.meta.url),
    );
    assert.equal(
      ajv.validateSchema(schema),
      true,
      `${schemaName}: ${ajv.errorsText(ajv.errors)}`,
    );
    const validate = ajv.compile(schema);
    const fixture = await json(
      new URL(`../fixtures/v3/${fixtureName}`, import.meta.url),
    );
    assert.equal(
      fixture.schemaVersion,
      schemaName === "scope-report.v1.schema.json"
        || schemaName === "source-history.v1.schema.json"
        ? "1.0.0"
        : MAIN_SCHEMA_VERSION,
    );
    assert.equal(
      validate(fixture),
      true,
      `${schemaName}/${fixtureName}: ${ajv.errorsText(validate.errors)}`,
    );
  }
});

test("v3 main schemas reject v2 records instead of silently migrating them", async () => {
  for (const [schemaName, fixtureName] of [
    ["annotation-records.v3.schema.json", "annotation-records.frozen.json"],
    ["change-request.v3.schema.json", "change-request.frozen.json"],
    ["project-state.v3.schema.json", "project-state.current-edited.json"],
    ["runtime-state.v3.schema.json", "runtime-state.ready.json"],
    ["version-manifest.v3.schema.json", "version-manifest.initial.json"],
  ]) {
    const ajv = validator();
    const schema = await json(
      new URL(`../schemas/${schemaName}`, import.meta.url),
    );
    const validate = ajv.compile(schema);
    const oldRecord = await json(
      new URL(`../fixtures/v2/${fixtureName}`, import.meta.url),
    );
    assert.equal(validate(oldRecord), false, `${schemaName} accepted v2 data`);
  }
});

test("v3 TargetRef requires explicit resolution and accepts source anchors plus fingerprints", async () => {
  const ajv = validator();
  const schema = await json(
    new URL("../schemas/change-request.v3.schema.json", import.meta.url),
  );
  const validate = ajv.compile(schema);
  const request = await json(
    new URL("../fixtures/v3/change-request.frozen.json", import.meta.url),
  );
  const [target] = request.requirements.targets;
  assert.equal(validate(request), true, ajv.errorsText(validate.errors));
  assert.equal(target.resolution, "exact");
  assert.equal(target.sourceAnchor.sourceSha256, request.baseSnapshot.sha256);
  assert.equal(target.fingerprint.stableAttributes.id, "metrics-grid");

  const missingResolution = structuredClone(request);
  delete missingResolution.requirements.targets[0].resolution;
  assert.equal(validate(missingResolution), false);

  for (const forbidden of [
    { moduleSelector: "main > section" },
    { anchor: { parentSelector: "main", index: 0 } },
  ]) {
    const incompatible = structuredClone(request);
    Object.assign(incompatible.requirements.targets[0], forbidden);
    assert.equal(
      validate(incompatible),
      false,
      "v3 TargetRef accepted a removed compatibility field",
    );
  }
});

test("v3 comments can bind project attachments to the same target and AI instruction", async () => {
  const attachment = {
    attachmentId: "attachment_reference_image",
    kind: "image",
    fileName: "参考图.png",
    mediaType: "image/png",
    byteLength: 2048,
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    relativePath: "requests/req_metrics_cards/input/attachments/comment_emphasize_value/attachment_reference_image-参考图.png",
    requestRelativePath: "input/attachments/comment_emphasize_value/attachment_reference_image-参考图.png",
    source: "clipboard",
  };

  const annotationAjv = validator();
  const annotationSchema = await json(
    new URL("../schemas/annotation-records.v3.schema.json", import.meta.url),
  );
  const validateAnnotations = annotationAjv.compile(annotationSchema);
  const annotations = await json(
    new URL("../fixtures/v3/annotation-records.frozen.json", import.meta.url),
  );
  annotations.comments[0].attachments = [attachment];
  assert.equal(
    validateAnnotations(annotations),
    true,
    annotationAjv.errorsText(validateAnnotations.errors),
  );

  const requestAjv = validator();
  const requestSchema = await json(
    new URL("../schemas/change-request.v3.schema.json", import.meta.url),
  );
  const validateRequest = requestAjv.compile(requestSchema);
  const request = await json(
    new URL("../fixtures/v3/change-request.frozen.json", import.meta.url),
  );
  request.requirements.instructions[0].attachmentRefs = [attachment.attachmentId];
  request.requirements.attachments = [{
    ...attachment,
    commentId: "comment_emphasize_value",
    targetRef: "target_metrics_grid",
    localPath: "/Users/test/Documents/PageRoot/项目记录/projects/指标系统__20260728-124315__01234567/requests/req_metrics_cards/input/attachments/comment_emphasize_value/attachment_reference_image-参考图.png",
  }];
  request.annotations.attachmentCount = 1;
  assert.equal(
    validateRequest(request),
    true,
    requestAjv.errorsText(validateRequest.errors),
  );

  const manifestAjv = validator();
  const manifestSchema = await json(
    new URL("../schemas/input-manifest.v1.schema.json", import.meta.url),
  );
  const validateManifest = manifestAjv.compile(manifestSchema);
  const manifest = await json(
    new URL("../fixtures/v3/input-manifest.frozen.json", import.meta.url),
  );
  manifest.readOrder.push(attachment.requestRelativePath);
  manifest.files.push({
    path: attachment.requestRelativePath,
    role: "reference",
    mediaType: attachment.mediaType,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
  });
  assert.equal(
    validateManifest(manifest),
    true,
    manifestAjv.errorsText(validateManifest.errors),
  );
});
