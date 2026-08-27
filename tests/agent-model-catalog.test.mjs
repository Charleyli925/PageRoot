import assert from "node:assert/strict";
import test from "node:test";

import { parsePublicModels } from "../bridge/agent-bridge-service.mjs";

// The model catalog is the first thing the renderer receives about Qoder that
// is not a bounded status enum, so the parser is the boundary that keeps raw
// CLI output from crossing. These pins hold that boundary.

test("plain model lines become safe id/displayName pairs", () => {
  const models = parsePublicModels("Qwen3.8-Max\nclaude-4.1\ngpt-5o\n");
  assert.deepEqual(models.map((model) => model.id), [
    "Qwen3.8-Max",
    "claude-4.1",
    "gpt-5o",
  ]);
  assert.ok(models.every((model) => model.displayName === model.id));
});

test("a leading MODEL header row is dropped", () => {
  const models = parsePublicModels("MODEL\nQwen3.8-Max\n");
  assert.deepEqual(models.map((model) => model.id), ["Qwen3.8-Max"]);
});

test("a table row keeps only the first token as the identifier", () => {
  const models = parsePublicModels("Qwen3.8-Max   default   2026-01-01\n");
  assert.deepEqual(models.map((model) => model.id), ["Qwen3.8-Max"]);
});

test("path-like, CJK-leading and empty lines never cross the boundary", () => {
  const models = parsePublicModels([
    "/Users/someone/.qoder/models/secret", // a path: leading "/" is not a valid start
    "模型名带中文和空格 描述", // CJK leading token is rejected
    "", // empty
    "   ", // whitespace only
  ].join("\n"));
  assert.deepEqual(models, []);
});

test("every surviving identifier is bounded and safe, whatever the CLI emits", () => {
  const models = parsePublicModels([
    "Qwen3.8-Max",
    "a".repeat(200), // over length: truncated and bounded, never unbounded
    "\u0007bell-control", // control byte stripped, then a plain identifier
  ].join("\n"));
  assert.ok(models.length >= 1);
  for (const model of models) {
    assert.ok(model.id.length <= 80, `id must be bounded: ${model.id.length}`);
    assert.match(model.id, /^[A-Za-z0-9][A-Za-z0-9._/:+-]*$/u);
    assert.equal(model.displayName, model.id);
  }
});

test("duplicate identifiers are collapsed", () => {
  const models = parsePublicModels("Qwen3.8-Max\nQwen3.8-Max\nclaude-4.1\n");
  assert.deepEqual(models.map((model) => model.id), ["Qwen3.8-Max", "claude-4.1"]);
});

test("the list is capped so a flooding CLI cannot overwhelm the renderer", () => {
  const flood = Array.from({ length: 200 }, (_v, index) => `model-${index}`).join("\n");
  const models = parsePublicModels(flood);
  assert.equal(models.length, 40);
});

test("no input yields an empty, frozen list", () => {
  assert.deepEqual(parsePublicModels(""), []);
  assert.deepEqual(parsePublicModels(null), []);
  assert.ok(Object.isFrozen(parsePublicModels("Qwen3.8-Max")));
});
