import { expect, test } from "@playwright/test";

import {
  activateNativeEdit,
  caseSelector,
  exportCurrentHtml,
  fixtureBuffer,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  replaceEditableIslandBytes,
  setTextSelection,
  sha256,
  withBomAndCrLf,
} from "./pageroot-driver.mjs";

const originalToken = "SOURCE_FIDELITY_TOKEN_001";
const replacement = "逐字节替换_OK";

function firstByteDifference(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  let offset = 0;
  while (offset < limit && actual[offset] === expected[offset]) offset += 1;
  const contextStart = Math.max(0, offset - 32);
  const contextEnd = Math.min(Math.max(actual.length, expected.length), offset + 96);
  return JSON.stringify({
    offset,
    actualLength: actual.length,
    expectedLength: expected.length,
    actual: actual.subarray(contextStart, Math.min(actual.length, contextEnd)).toString("utf8"),
    expected: expected.subarray(contextStart, Math.min(expected.length, contextEnd)).toString("utf8"),
  });
}

async function waitForNativeSession(frame, caseId) {
  await expect.poll(() => nativeEditingState(frame, caseId)).toMatchObject({
    targetIsActive: true,
    contenteditable: "true",
    selectionInside: true,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("one text edit changes only the authorized UTF-8 bytes, including BOM and CRLF", async ({ page }) => {
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceEditableIslandBytes(
    original,
    "source-fidelity",
    `<span title='single-quoted' data-order-b="2" data-order-a='1'>${replacement}</span>`,
  );
  const { frame } = await loadFixture(page, "source-fidelity.html", { buffer: original });
  await activateNativeEdit(frame, "source-fidelity");
  await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
  await page.keyboard.insertText(replacement);
  expect(await frame.locator(caseSelector("source-fidelity")).textContent()).toBe(replacement);

  await page.keyboard.press(keyShortcut("S"));
  const actual = await exportCurrentHtml(page);

  expect(
    actual.equals(expected),
    `target range is the only changed byte range: ${firstByteDifference(actual, expected)}`,
  ).toBe(true);
  expect(sha256(actual), "exported byte hash").toBe(sha256(expected));
});

test("source reversal shortcuts are blocked and never change committed bytes", async ({ page }) => {
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceEditableIslandBytes(
    original,
    "source-fidelity",
    `<span title='single-quoted' data-order-b="2" data-order-a='1'>${replacement}</span>`,
  );
  const { frame } = await loadFixture(page, "source-fidelity.html", { buffer: original });
  await activateNativeEdit(frame, "source-fidelity");
  await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
  await page.keyboard.insertText(replacement);

  await page.keyboard.press(keyShortcut("Z"));
  await expect.poll(() => frame.locator(caseSelector("source-fidelity")).textContent())
    .toBe(replacement);
  await waitForNativeSession(frame, "source-fidelity");

  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`);
  await expect.poll(() => frame.locator(caseSelector("source-fidelity")).textContent())
    .toBe(replacement);
  await waitForNativeSession(frame, "source-fidelity");
  expect(await nativeEditingState(frame, "source-fidelity")).toMatchObject({
    targetIsActive: true,
    contenteditable: "true",
    selectionInside: true,
  });

  const exported = await exportCurrentHtml(page);
  expect(exported.equals(expected), firstByteDifference(exported, expected)).toBe(true);
});

test("selection and comment-only interaction never changes source bytes", async ({ page }) => {
  const original = fixtureBuffer("complex-layout.html");
  const { frame } = await loadFixture(page, "complex-layout.html", { buffer: original });
  await frame.locator(caseSelector("vertical-copy")).dblclick();
  await frame.locator(caseSelector("canvas-surface")).dispatchEvent("click", {
    bubbles: true,
    cancelable: true,
  });

  const actual = await exportCurrentHtml(page);
  expect(actual.equals(original)).toBe(true);
});
