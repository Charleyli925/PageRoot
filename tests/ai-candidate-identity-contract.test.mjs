import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(
  new URL(`../${relativePath}`, import.meta.url),
  "utf8",
);

test("ADR 0067 and Architecture Contract freeze full-HTML Candidate identity", async () => {
  const [adr, architecture, interaction, validation, promptOwner] = await Promise.all([
    read("docs/decisions/0067-ai-candidate-source-identity.md"),
    read("docs/ARCHITECTURE_CONTRACT.md"),
    read("docs/INTERACTION_FLOW.md"),
    read("docs/AI_SUPPLEMENT_AND_VALIDATION.md"),
    read("bridge/workspace-bridge.mjs"),
  ]);
  const normalized = [adr, architecture, interaction, validation, promptOwner]
    .map((value) => value.replace(/\s+/gu, " "));

  for (const required of [
    "Comment locations and text ranges are context",
    "same element may move within or across parents",
    "same valid unique ID remains the sole element identity",
    "Equal-cardinality repeated exact-source or stable retained-neighbour groups also fail closed",
    "Suspicious identity loss fails closed",
    "genuinely new",
    "submitted AI-output Hash and normalized Candidate Hash",
    "normalized complete HTML",
    "Runtime DOM",
    "not required to emit semantic operations",
  ]) {
    assert.ok(normalized[0].includes(required), `ADR 0067 lost contract: ${required}`);
  }
  for (const required of [
    "sole AI Candidate source-identity validator",
    "comments and text ranges provide context but never restrict",
    "Duplicate, malformed or invented IDs fail closed",
    "not a second element identity",
    "equal-cardinality repeated exact-source or stable retained-neighbour group fails closed",
    "Only after those checks",
    "submitted-output Hash separately from the normalized complete Candidate Hash",
    "cannot overwrite the current Working Copy before adoption",
    "without the optional report remain read-only compatible",
  ]) {
    assert.ok(normalized[1].includes(required), `Architecture Contract lost boundary: ${required}`);
  }
  assert.match(interaction, /一条评论可以要求同时修改多个远距离区域/u);
  assert.match(interaction, /真正新增的元素不填 ID/u);
  assert.match(validation, /不做\s*启发式重绑/u);
  assert.match(promptOwner, /不得伪造或复制/u);
  assert.match(promptOwner, /Stable ID 是唯一元素身份/u);
});

test("Candidate v4 schema admits sealed submitted and normalized identity evidence", async () => {
  const schema = JSON.parse(await read("schemas/candidate.v4.schema.json"));
  const report = schema.$defs.identityReport;
  assert.equal(report.additionalProperties, false);
  assert.deepEqual(report.properties.status, { const: "verified" });
  for (const property of [
    "baseElementCount",
    "outputElementCount",
    "retainedElementCount",
    "deletedElementCount",
    "addedElementCount",
    "assignedElementCount",
    "baseIdentityBindingSha256",
    "outputIdentityBindingSha256",
    "submittedOutputSha256",
    "outputSha256",
  ]) {
    assert.ok(report.required.includes(property), `identity report must require ${property}`);
  }
  assert.ok(schema.properties.submittedOutputSha256);
  assert.deepEqual(schema.properties.identityReport, { $ref: "#/$defs/identityReport" });
  assert.equal(
    schema.required.includes("identityReport"),
    false,
    "old sealed schema-v4 Candidates remain readable",
  );
});
