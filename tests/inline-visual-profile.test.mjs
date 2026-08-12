import assert from "node:assert/strict";
import test from "node:test";

import {
  INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES,
  INLINE_VISUAL_PROFILE_TIERS,
  summarizeInlineVisualProfileForTelemetry,
  validateInlineVisualProfile,
} from "../app/domain/inline-visual-profile.js";

const VALID_PROFILE = `<!doctype html>
<html>
  <head><meta name="pageroot-report-profile" content="0.1"></head>
  <body>
    <figure data-report-key="search-volume-trend">
      <div
        id="search-volume-chart"
        data-report-visual-slot="fixed"
        data-report-visual-kind="chart"
        role="img"
        aria-label="synthetic chart"
        style="width: 640px; aspect-ratio: 16 / 9"
      ></div>
    </figure>
  </body>
</html>`;

function diagnosticCodes(report) {
  return report.diagnostics.map((diagnostic) => diagnostic.code).sort();
}

test("Profile v0.1 accepts a source-backed fixed slot without changing the supplied bytes", () => {
  const source = VALID_PROFILE;
  const report = validateInlineVisualProfile(source);

  assert.equal(report.tier, INLINE_VISUAL_PROFILE_TIERS.PROFILE_FIXED);
  assert.equal(report.contractVersion, "0.1");
  assert.equal(report.slots.length, 1);
  assert.equal(report.slots[0].reportKey, "search-volume-trend");
  assert.equal(report.slots[0].id, "search-volume-chart");
  assert.deepEqual(report.slots[0].diagnostics, []);
  assert.ok(report.sourceSha256.startsWith("sha256:"));
  assert.equal(source, VALID_PROFILE);
});

test("Profile diagnostics are deterministic for missing, duplicate and unsupported declarations", () => {
  const source = VALID_PROFILE
    .replace('content="0.1"', 'content="9.9"')
    .replace("</head>", '<meta name="pageroot-report-profile" content="0.1"></head>');
  const report = validateInlineVisualProfile(source);

  assert.equal(report.tier, INLINE_VISUAL_PROFILE_TIERS.PREVIEW_ONLY);
  assert.deepEqual(diagnosticCodes(report), [
    INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_DUPLICATE,
    INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.PROFILE_UNSUPPORTED_VERSION,
  ]);
});

test("Profile rejects ambiguous identities, dynamic geometry and non-visual runtime content", () => {
  const source = `<!doctype html><html><head>
    <meta name="pageroot-report-profile" content="0.1">
  </head><body>
    <section data-report-key="same-key">
      <div id="duplicate" data-report-visual-slot="fixed" data-report-visual-kind="chart" aria-label="a"><table><tbody><tr><td>x</td></tr></tbody></table></div>
      <div id="duplicate" data-report-visual-slot="fixed" data-report-visual-kind="chart" aria-label="b" style="height: 100px"></div>
    </section>
  </body></html>`;
  const report = validateInlineVisualProfile(source);
  const codes = diagnosticCodes(report);

  assert.equal(report.tier, INLINE_VISUAL_PROFILE_TIERS.PREVIEW_ONLY);
  assert.ok(codes.includes(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_ID));
  assert.ok(codes.includes(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_REPORT_KEY));
  assert.ok(codes.includes(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DYNAMIC_OR_UNKNOWN_GEOMETRY));
  assert.ok(codes.includes(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_NON_VISUAL_RUNTIME_CONTENT));
});

test("Profile detects nested slots and does not use script text as markup", () => {
  const source = `<!doctype html><html><head>
    <meta name="pageroot-report-profile" content="0.1">
  </head><body>
    <div data-report-key="outer">
      <div id="outer-slot" data-report-visual-slot="fixed" data-report-visual-kind="chart" aria-label="outer" style="height: 120px">
        <div data-report-key="inner"><div id="inner-slot" data-report-visual-slot="fixed" data-report-visual-kind="chart" aria-label="inner" style="height: 80px"></div></div>
      </div>
    </div>
    <script>"<div data-report-visual-slot='fixed'></div>";</script>
  </body></html>`;
  const report = validateInlineVisualProfile(source);

  assert.equal(report.slots.length, 2);
  assert.ok(diagnosticCodes(report).includes(
    INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_NESTED_OR_OVERLAPPING,
  ));
});

test("Profile fails closed for duplicate slot attributes and malformed source", () => {
  const duplicateAttribute = VALID_PROFILE.replace(
    'data-report-visual-slot="fixed"',
    'data-report-visual-slot="fixed" data-report-visual-slot="fixed"',
  );
  const malformed = `${VALID_PROFILE}<`;
  const duplicateReport = validateInlineVisualProfile(duplicateAttribute);
  const malformedReport = validateInlineVisualProfile(malformed);

  assert.equal(duplicateReport.tier, INLINE_VISUAL_PROFILE_TIERS.PREVIEW_ONLY);
  assert.ok(diagnosticCodes(duplicateReport).includes(
    INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_DUPLICATE_ATTRIBUTE,
  ));
  assert.equal(malformedReport.tier, INLINE_VISUAL_PROFILE_TIERS.PREVIEW_ONLY);
  assert.ok(diagnosticCodes(malformedReport).includes(
    INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SOURCE_PARSE_INVALID,
  ));
});

test("Profile enforces a bounded slot budget and legacy candidates never become supported slots", () => {
  const manySlots = Array.from({ length: 3 }, (_, index) => `
    <div data-report-key="chart-${index}" id="chart-${index}" data-report-visual-slot="fixed" data-report-visual-kind="chart" aria-label="chart ${index}" style="height: 100px"></div>`).join("\n");
  const report = validateInlineVisualProfile(
    VALID_PROFILE.replace("</body>", `${manySlots}</body>`),
    { maximumSlots: 2 },
  );
  const legacy = validateInlineVisualProfile(`<!doctype html><canvas id="legacy" style="height: 80px"></canvas>`);

  assert.equal(report.tier, INLINE_VISUAL_PROFILE_TIERS.PREVIEW_ONLY);
  assert.ok(diagnosticCodes(report).includes(INLINE_VISUAL_PROFILE_DIAGNOSTIC_CODES.SLOT_BUDGET_EXCEEDED));
  assert.equal(legacy.tier, INLINE_VISUAL_PROFILE_TIERS.LEGACY_CANDIDATE);
  assert.equal(legacy.legacyCandidates.length, 1);
  assert.equal(legacy.slots.length, 0);
});

test("Profile diagnostics carry only stable source locations, while telemetry candidates omit source facts", () => {
  const privateText = "never-emit-this-content-or-a-local-path";
  const source = VALID_PROFILE.replace('aria-label="synthetic chart"', `aria-label="${privateText}"`);
  const report = validateInlineVisualProfile(source);
  const telemetry = summarizeInlineVisualProfileForTelemetry(report);
  const serializedReport = JSON.stringify(report);
  const serializedTelemetry = JSON.stringify(telemetry);

  assert.equal(report.diagnostics.length, 0);
  assert.ok(report.slots[0].sourceRange.start.line >= 1);
  assert.equal(serializedTelemetry.includes(privateText), false);
  assert.equal(serializedTelemetry.includes("search-volume-trend"), false);
  assert.equal(serializedTelemetry.includes("sourceSha256"), false);
  assert.ok(serializedReport.includes("sourceRange"));
});

test("Profile rejects invalid validation options instead of widening its budget", () => {
  assert.throws(
    () => validateInlineVisualProfile(VALID_PROFILE, { maximumSlots: 0 }),
    /maximumSlots/u,
  );
  assert.throws(
    () => validateInlineVisualProfile(VALID_PROFILE, { maximumSlots: 257 }),
    /maximumSlots/u,
  );
});
