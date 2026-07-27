import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chooseNativeEditHostMode,
  classifyNativeEventDelivery,
} from "../app/lib/native-edit-policy.js";

test("native host and display-contents decisions are explicit policy outcomes", () => {
  assert.equal(
    chooseNativeEditHostMode({
      plaintextOnly: { layoutStable: false, styleStable: true },
      controlled: { layoutStable: true, styleStable: true },
    }),
    "true",
  );
  assert.equal(
    classifyNativeEventDelivery({
      hasDisplayContents: true,
      observerReady: true,
    }),
    "observer-guarded",
  );
  assert.equal(
    classifyNativeEventDelivery({
      hasDisplayContents: true,
      observerReady: false,
    }),
    "unsafe",
  );
});

test("native preflight distinguishes an idle transition from real layout or author-DOM drift", async () => {
  const preflight = await readFile(
    new URL("../app/components/native-edit-runtime-preflight.ts", import.meta.url),
    "utf8",
  );

  assert.match(preflight, /function sameNativeTextStyle/u);
  assert.match(
    preflight,
    /function sameNativeLayout[\s\S]*?Math\.abs\(left\.width - right\.width\)[\s\S]*?sameTextRects/u,
  );
  assert.match(
    preflight,
    /uaOwnedEditingWhiteSpace[\s\S]*?"nowrap"[\s\S]*?"pre"[\s\S]*?whiteSpaceStable/u,
    "UA white-space renaming is allowed only alongside the independent geometry gate",
  );
  assert.doesNotMatch(
    preflight,
    /function sameNativeLayout[\s\S]*?left\.transitionDuration === right\.transitionDuration/u,
  );
  assert.match(
    preflight,
    /preflightObserver\?\.observe\(documentNode\.documentElement[\s\S]*?unexpectedPreflightMutations[\s\S]*?authorMutationRisk:/u,
  );
  assert.match(
    preflight,
    /measureMode\(NATIVE_EDIT_HOST_MODE\.PLAINTEXT_ONLY\)[\s\S]*?measureMode\(NATIVE_EDIT_HOST_MODE\.CONTROLLED\)/u,
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

test("collapsed boundary insertion has deterministic ownership for keyboard, IME, and toolbar style", async () => {
  const [controller, canvas, logicalIndex] = await Promise.all([
    readFile(
      new URL("../app/components/NativeEditingController.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/lib/native-dom-logical-index.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    controller,
    /const COLLAPSED_TEXT_INSERT_INPUT_TYPES = new Set\(\[[\s\S]*?"insertCompositionText"[\s\S]*?"insertFromComposition"[\s\S]*?"insertText"[\s\S]*?\]\)/u,
  );
  assert.match(
    logicalIndex,
    /isTransparentSourceTextElement\(element\.localName\)[\s\S]*?transparentInlineRanges\.push/u,
  );
  assert.match(
    logicalIndex,
    /function transparentInlineLogicalRanges[\s\S]*?return index\.transparentInlineRanges/u,
  );
  assert.match(
    controller,
    /if \(ranges\.length > 1\) return false;[\s\S]*?if \(!targetRange\.collapsed\) return false;[\s\S]*?if \(!selection\.isCollapsed\) return false;/u,
    "non-collapsed replacements must stay outside the narrow boundary detector",
  );
  assert.match(
    controller,
    /collapsedInsertionAffinity[\s\S]*?\^\\s\*\$[\s\S]*?return "right";[\s\S]*?return "left";/u,
  );
  assert.match(
    controller,
    /setSelectionValue\(this\.hostElement, compositionSelection\)/u,
  );
  assert.match(
    controller,
    /handleOwnedCollapsedTextInsertion\(event\)[\s\S]*?insertionTargetsInlineBoundary[\s\S]*?insertionTouchesCollapsedWhitespaceEdge/u,
  );
  assert.match(
    canvas,
    /activeNativeEditRef\.current\?\.session\.getStyleElementsForSelection\(\)/u,
  );
});
