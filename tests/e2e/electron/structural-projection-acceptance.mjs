import { expect } from "@playwright/test";
import { requireIndependentProjectionExpectation } from "./real-html/frozen-structure.mjs";

export async function readStructuralProjection(editor) {
  return {
    kind: await editor.getAttribute("data-structural-projection-kind"),
    planned: await editor.getAttribute("data-structural-projection-planned"),
    outcome: await editor.getAttribute("data-structural-projection-outcome"),
    reason: await editor.getAttribute("data-structural-projection-reason"),
  };
}

export async function waitForIndependentProjection(editor, expectedProjection, extra = {}) {
  await expect.poll(async () => readStructuralProjection(editor), { timeout: 5_000 })
    .toMatchObject({ outcome: expectedProjection, ...extra });
  const actual = await readStructuralProjection(editor);
  requireIndependentProjectionExpectation({ expectedProjection }, actual.kind, actual.outcome);
  return actual;
}

export async function invokeStructureCommand(page, command, options = {}) {
  return page.getByTestId("html-canvas-editor").evaluate((element, payload) => {
    const commands = element.__STEMMIO_E2E_STRUCTURE_COMMANDS__;
    const run = commands?.[payload.command];
    if (typeof run !== "function") {
      throw new Error(`STRUCTURE_COMMAND_UNAVAILABLE:${payload.command}`);
    }
    return run(payload.options);
  }, { command, options });
}

export async function activeFrameGeneration(editor) {
  return editor.locator('iframe:not([data-frame-role])').getAttribute("data-frame-generation");
}
