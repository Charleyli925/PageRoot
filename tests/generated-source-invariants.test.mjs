import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  planSourcePatch,
} from "../app/lib/source-patch-core.js";

const PROFILE_COUNT = 24;
const TAGS = ["p", "h2", "li", "blockquote", "figcaption"];
const NEWLINES = ["\n", "\r\n"];
const QUOTES = ['"', "'"];
const PREFIXES = ["中文", "e\u0301", "emoji😀", "עברית", "العربية", "日本語"];

function seededNumber(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function escapeHtmlText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function generatedProfile(index) {
  const seed = 0x50414745 + index * 7_919;
  const random = seededNumber(seed);
  const newline = NEWLINES[index % NEWLINES.length];
  const quote = QUOTES[Math.floor(index / 2) % QUOTES.length];
  const tag = TAGS[(index * 3) % TAGS.length];
  const prefix = PREFIXES[(index * 5) % PREFIXES.length];
  const beforeText = `目标_${seed}_${prefix}`;
  const nextText = `改后_${random().toString(16)}_${prefix}<安全&精确`;
  const outsideToken = `OUTSIDE_${random().toString(16)}_${seed}`;
  const bom = index % 3 === 0 ? "\uFEFF" : "";
  const indentation = " ".repeat((index % 4) * 2);
  const attributes = `id=${quote}generated-target${quote} data-seed=${quote}${seed}${quote}`;
  const lines = [
    "<!doctype html>",
    `<html data-profile=${quote}${index}${quote}>`,
    "<head><meta charset='utf-8'><title>Generated fixture</title></head>",
    "<body>",
    `${indentation}<!-- keep:${outsideToken} -->`,
    `${indentation}<section data-json=${quote}{&quot;keep&quot;:&quot;${outsideToken}&quot;}${quote}>`,
    `${indentation}  <${tag} ${attributes}>${beforeText}</${tag}>`,
    `${indentation}  <aside data-keep='first' aria-label=second>&copy; &amp; ${outsideToken}</aside>`,
    `${indentation}</section>`,
    `<script>globalThis.__GENERATED_SENTINEL__ = ${JSON.stringify(outsideToken)};</script>`,
    "</body>",
    "</html>",
  ];
  const html = `${bom}${lines.join(newline)}${newline}`;
  const expected = html.replace(beforeText, escapeHtmlText(nextText));
  return { seed, html, expected, beforeText, nextText, outsideToken, newline, bom };
}

test("deterministic generated HTML corpus preserves every byte outside one authorized text patch", () => {
  const seen = new Set();
  for (let index = 0; index < PROFILE_COUNT; index += 1) {
    const profile = generatedProfile(index);
    const label = `generated seed ${profile.seed}`;
    assert.equal(seen.has(profile.seed), false, `${label}: seed must be unique`);
    seen.add(profile.seed);

    const sourceIndex = buildSourceIndex(profile.html);
    const target = sourceIndex.elements.find(
      (element) => element.stableAttributes.id === "generated-target",
    );
    assert.ok(target, `${label}: target must be source-addressable`);
    const targetRef = createTargetRef(sourceIndex, target.nodeId, { level: "text" });
    const plan = planSourcePatch({
      type: "replace-text",
      targetRef,
      beforeText: profile.beforeText,
      nextText: profile.nextText,
      expectedSourceSha256: sourceIndex.sourceSha256,
    }, sourceIndex);
    const applied = applyPatchPlan(plan, profile.html);

    assert.equal(applied.html, profile.expected, `${label}: forward bytes`);
    assert.equal(applied.patches.length, 1, `${label}: one minimal patch`);
    assert.equal(applied.scopeReport.outsideUnchanged, true, `${label}: outside scope`);
    assert.equal(applied.parseIntegrity.ok, true, `${label}: parse integrity`);
    assert.ok(applied.html.includes(profile.outsideToken), `${label}: outside sentinel`);
    assert.equal(applied.html.charCodeAt(0) === 0xfeff, Boolean(profile.bom), `${label}: BOM`);
    assert.equal(applied.html.includes(profile.newline), true, `${label}: line ending`);

    const undone = applyPatchPlan(applied.inversePlan, applied.html);
    assert.equal(undone.html, profile.html, `${label}: inverse bytes`);
    assert.equal(sha256(undone.html), sha256(profile.html), `${label}: inverse SHA`);
    const redone = applyPatchPlan(undone.inversePlan, undone.html);
    assert.equal(redone.html, profile.expected, `${label}: redo bytes`);
    assert.equal(sha256(redone.html), sha256(profile.expected), `${label}: redo SHA`);
  }
});
