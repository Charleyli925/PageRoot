import assert from "node:assert/strict";
import test from "node:test";

import { isNativeDirectEditRoot } from "../app/lib/native-edit-capability.js";

test("treats authored text hosts as direct-edit roots", () => {
  for (const tag of [
    "p",
    "h1",
    "div",
    "span",
    "summary",
    "li",
    "td",
    "blockquote",
    "odd-card",
  ]) {
    assert.equal(isNativeDirectEditRoot(tag), true, tag);
  }
});

test("rejects dedicated editors, voids, and collection or document boundaries", () => {
  for (const tag of [
    "button",
    "textarea",
    "input",
    "script",
    "style",
    "pre",
    "code",
    "html",
    "head",
    "body",
    "table",
    "tr",
    "ul",
    "ol",
    "form",
    "br",
    "img",
    "meta",
  ]) {
    assert.equal(isNativeDirectEditRoot(tag), false, tag);
  }
});

test("empty or missing tag names are not direct-edit roots", () => {
  assert.equal(isNativeDirectEditRoot(""), false);
  assert.equal(isNativeDirectEditRoot(null), false);
  assert.equal(isNativeDirectEditRoot(undefined), false);
});
