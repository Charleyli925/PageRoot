import assert from "node:assert/strict";
import test from "node:test";

import { staleVersionSentence } from "../app/workbench/external-open-copy.js";

test("reopening an already imported original stays silent about matching versions", () => {
  // The confirmation exists to stop a duplicate import. When the Working Copy is
  // already on the newest Version there is nothing about versions worth an extra
  // sentence, so the dialog must not grow one.
  assert.equal(staleVersionSentence(1, 1), "");
  assert.equal(staleVersionSentence(6, 6), "");
});

test("a Working Copy parked on an older Version says where opening lands", () => {
  const sentence = staleVersionSentence(2, 6);
  assert.match(sentence, /你上次是从第 2 版继续编辑的/u);
  assert.match(sentence, /打开后仍在第 2 版/u);
  assert.match(sentence, /项目最新为第 6 版，可在项目里切换至最新版/u);
});

test("stale version copy never invents a version number it was not given", () => {
  // Missing, zero and unparsable ordinals mean the facts are unknown. Guessing
  // here would tell the user they are on a Version the project may not have.
  assert.equal(staleVersionSentence(undefined, undefined), "");
  assert.equal(staleVersionSentence(undefined, 6), "");
  assert.equal(staleVersionSentence(2, undefined), "");
  assert.equal(staleVersionSentence(0, 6), "");
  assert.equal(staleVersionSentence("", 6), "");
  assert.equal(staleVersionSentence("two", 6), "");
});

test("a Working Copy ahead of the recorded latest Version stays silent", () => {
  // Ordinals can only disagree this way while a promotion is still settling.
  // Announcing a "newest" Version behind the user's own edit would be wrong.
  assert.equal(staleVersionSentence(7, 6), "");
});
