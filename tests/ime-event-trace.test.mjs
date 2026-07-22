import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const trace = JSON.parse(await readFile(
  new URL("./fixtures/native-dom/apple-pinyin-em-wrapper-trace.json", import.meta.url),
  "utf8",
));

test("captured Apple Pinyin trace preserves the wrapper-churn regression oracle", () => {
  assert.equal(trace.initial.selectionText, "Word");
  assert.match(trace.initial.html, /<em[^>]*>Word<\/em>/u);

  const compositionInputs = trace.events.filter((event) => (
    event.type === "input"
    && event.inputType === "insertCompositionText"
  ));
  assert.deepEqual(
    compositionInputs.map((event) => event.data),
    ["n", "ni", "ni h", "ni hao", "你好"],
  );
  assert.match(compositionInputs[0].html, /<em[^>]*>n<\/em>/u);
  assert.match(compositionInputs[1].html, /<em[^>]*>ni<\/em>/u);
  assert.match(compositionInputs[2].html, /<i>ni h<\/i>/u);
  assert.match(compositionInputs[3].html, /<i>ni hao<\/i>/u);
  assert.match(compositionInputs[4].html, /<i>你好<\/i>/u);

  const terminal = trace.events.at(-1);
  assert.deepEqual(
    { type: terminal.type, data: terminal.data },
    { type: "compositionend", data: "你好" },
  );
  assert.deepEqual(trace.expectedCanonical, {
    text: "真实 DOM 光标要像 你好 一样自然 🙂",
    inlineHtml: "<em>你好</em>",
    sourceReplacement: { before: "Word", after: "你好" },
    historyEntries: 1,
  });
});

test("captured trace includes event trust, terminal key and no serialized source mutation", () => {
  assert.ok(trace.events.every((event) => typeof event.isTrusted === "boolean"));
  assert.ok(trace.events.some((event) => (
    event.type === "keydown"
    && event.code === "Space"
    && event.isComposing === true
  )));
  assert.ok(trace.events.some((event) => (
    event.type === "beforeinput"
    && event.data === "你好"
    && event.isComposing === true
  )));
  assert.ok(trace.events.every((event) => (
    !event.html || !event.html.includes("data-html-canvas-native-editing")
  )));
});
