import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function computedStyleModule() {
  const input = await source("app/components/html-canvas-computed-style.ts");
  const output = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function fakeElement(style) {
  const calls = [];
  const element = {
    isConnected: true,
    ownerDocument: {
      defaultView: {
        getComputedStyle(candidate) {
          calls.push(candidate);
          return candidate === element ? style : style;
        },
      },
    },
  };
  return { element, calls };
}

test("computed style reader exposes only browser-resolved presentation", async () => {
  const { element, calls } = fakeElement({
    fontSize: "18px",
    color: "rgb(12, 34, 56)",
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    paddingTop: "7.4px",
    marginTop: "2px",
    lineHeight: "27px",
    fontWeight: "700",
    fontStyle: "oblique",
    textDecorationLine: "underline",
  });
  const computedStyleApi = await computedStyleModule();
  const result = computedStyleApi.readComputedEditableStyle(element);

  assert.deepEqual(result, {
    fontSize: 18,
    color: "#0c2238",
    backgroundColor: "#ffffff",
    padding: 7,
    margin: 2,
    lineHeight: 27,
    isBold: true,
    isItalic: true,
    isUnderline: true,
  });
  assert.ok(calls.length > 0);
  assert.equal("styleSheets" in element.ownerDocument, false);
});

test("range toggles are derived from each selected element's computed style", async () => {
  const first = {
    isConnected: true,
    ownerDocument: { defaultView: { getComputedStyle: () => ({
      fontSize: "16px",
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      paddingTop: "0px",
      marginTop: "0px",
      lineHeight: "normal",
      fontWeight: "700",
      fontStyle: "italic",
      textDecorationLine: "underline",
    }) } },
  };
  const second = {
    isConnected: true,
    ownerDocument: { defaultView: { getComputedStyle: () => ({
      fontSize: "16px",
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      paddingTop: "0px",
      marginTop: "0px",
      lineHeight: "normal",
      fontWeight: "400",
      fontStyle: "normal",
      textDecorationLine: "none",
    }) } },
  };
  const computedStyleApi = await computedStyleModule();
  const result = computedStyleApi.readComputedEditableStyle(first, [first, second]);

  assert.equal(result.fontSize, 16);
  assert.equal(result.lineHeight, 24);
  assert.equal(result.isBold, false);
  assert.equal(result.isItalic, false);
  assert.equal(result.isUnderline, false);
});

test("the editor uses computed values and writes only local inline facts", async () => {
  const computed = await source("app/components/html-canvas-computed-style.ts");
  const editor = await source("app/components/HtmlCanvasEditor.tsx");
  const componentFiles = [
    computed,
    editor,
    await source("app/components/html-canvas-selection-chrome-contract.ts"),
  ].join("\n");

  for (const pattern of [
    /cssRules/u,
    /selectorSpecificity/u,
    /sharedImpactCount/u,
    /mediaCondition/u,
    /StyleSourceInfo/u,
    /styleSourcesForElement/u,
  ]) {
    assert.doesNotMatch(componentFiles, pattern);
  }
  assert.match(computed, /export function readComputedEditableStyle/u);
  assert.doesNotMatch(editor, /selectedStyle\.sources/u);
  assert.match(editor, /inlineValue/u);
  assert.match(editor, /inlinePriority/u);
  assert.match(editor, /这个样式无法通过当前元素的局部修改可靠生效/u);
  assert.doesNotMatch(editor, /sourceValue/u);
  assert.doesNotMatch(editor, /provenance:/u);
});
