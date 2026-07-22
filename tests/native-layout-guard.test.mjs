import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native preflight rejects display:contents and generated content anywhere in the text island", async () => {
  const [canvas, capability] = await Promise.all([
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/native-edit-capability.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    canvas,
    /function hasGeneratedPseudoContent[\s\S]*?querySelectorAll<HTMLElement>\("\*"\)[\s\S]*?hasContent\(candidate, "::before"\)[\s\S]*?hasContent\(candidate, "::after"\)/u,
  );
  assert.match(
    canvas,
    /const nativeEventDeliveryStable = \[[\s\S]*?rootElement\.querySelectorAll<HTMLElement>\("\*"\)[\s\S]*?getComputedStyle\(element\)\.display\.toLowerCase\(\) !== "contents"/u,
  );
  assert.match(
    canvas,
    /pseudoContent: hasGeneratedPseudoContent\(rootElement\)/u,
  );
  assert.match(
    canvas,
    /nativeEventDeliveryStable,/u,
  );
  assert.match(
    capability,
    /runtime\.nativeEventDeliveryStable !== true/u,
    "missing event-delivery evidence must fail closed, not inherit an old permissive default",
  );
});

test("native preflight distinguishes an idle transition from real layout or author-DOM drift", async () => {
  const canvas = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );

  assert.match(canvas, /function sameNativeTextStyle/u);
  assert.match(
    canvas,
    /function sameNativeLayout[\s\S]*?Math\.abs\(left\.width - right\.width\)[\s\S]*?sameTextRects/u,
  );
  assert.match(
    canvas,
    /uaOwnedEditingWhiteSpace[\s\S]*?"nowrap"[\s\S]*?"pre"[\s\S]*?whiteSpaceStable/u,
    "UA white-space renaming is allowed only alongside the independent geometry gate",
  );
  assert.doesNotMatch(
    canvas,
    /function sameNativeLayout[\s\S]*?left\.transitionDuration === right\.transitionDuration/u,
  );
  assert.match(
    canvas,
    /preflightObserver\?\.observe\(documentNode\.documentElement[\s\S]*?unexpectedPreflightMutations[\s\S]*?authorMutationRisk:/u,
  );
});

test("text-range formatting uses an event-stable wrapper while retaining live layout guards", async () => {
  const [canvas, sourcePatch] = await Promise.all([
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/source-patch-engine.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    sourcePatch,
    /const TEXT_RANGE_LAYOUT_GUARD = "all: unset; display: inline !important"/u,
  );
  assert.doesNotMatch(
    sourcePatch,
    /TEXT_RANGE_LAYOUT_GUARD\s*=\s*["'][^"']*display\s*:\s*contents/iu,
  );
  assert.match(
    canvas,
    /hasFlexOrGridTextParent[\s\S]*?\["flex", "inline-flex", "grid", "inline-grid"\][\s\S]*?createsRangeWrapper[\s\S]*?hasFlexOrGridTextParent/u,
  );
  assert.match(
    canvas,
    /createsRangeWrapper && property === "backgroundColor"/u,
  );
  assert.match(canvas, /sourceTextParentsForSegments\(/u);
});

test("ambiguous inline insertion guard owns only collapsed text input and precedes IME commit matching", async () => {
  const [controller, canvas] = await Promise.all([
    readFile(
      new URL("../app/components/NativeEditingController.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    controller,
    /const COLLAPSED_TEXT_INSERT_INPUT_TYPES = new Set\(\[[\s\S]*?"insertCompositionText"[\s\S]*?"insertFromComposition"[\s\S]*?"insertText"[\s\S]*?\]\)/u,
  );
  assert.match(
    controller,
    /function transparentInlineLogicalRanges[\s\S]*?isTransparentSourceTextElement\(element\.localName\)/u,
  );
  assert.match(
    controller,
    /if \(ranges\.length > 1\) return false;[\s\S]*?if \(!targetRange\.collapsed\) return false;[\s\S]*?if \(!selection\.isCollapsed\) return false;/u,
    "non-collapsed replacements must stay outside this narrow caret guard",
  );

  const compositionBoundaryGate = controller.indexOf(
    "this.composing\n      && this.ambiguousCompositionOrigin",
  );
  const matchingCompositionCommit = controller.indexOf(
    "if (this.isMatchingCompositionCommitEvent(event))",
  );
  assert.ok(compositionBoundaryGate >= 0);
  assert.ok(matchingCompositionCommit > compositionBoundaryGate);
  assert.match(
    controller,
    /this\.blockedAmbiguousCompositionEpochId = epoch\.id;[\s\S]*?this\.restoreCompositionSnapshot\(true\)/u,
  );
  assert.match(
    controller,
    /isBlockedAmbiguousCompositionDelivery\(event\)[\s\S]*?event\.preventDefault\(\)/u,
  );
  assert.match(
    canvas,
    /inputType === "insertAtAmbiguousInlineBoundary"[\s\S]*?两种样式的边界[\s\S]*?添加评论/u,
  );
});
