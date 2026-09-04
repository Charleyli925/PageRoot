import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import * as sourceHistory from "../shared/source-history.mjs";

const retiredRoute = ["", "source-history", "action"].join("/");
const retiredSchema = ["source-history", "v1", "schema", "json"].join(".");

test("Bridge source-history compatibility route and client stay retired", () => {
  const bridge = readFileSync(
    new URL("../bridge/workspace-bridge.mjs", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../app/application/bridge-client.js", import.meta.url),
    "utf8",
  );
  const clientTypes = readFileSync(
    new URL("../app/application/bridge-client.d.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(bridge, new RegExp(retiredRoute.replaceAll("/", "\\/"), "u"));
  assert.doesNotMatch(client, /sourceHistoryAction/u);
  assert.doesNotMatch(clientTypes, /sourceHistoryAction/u);
});

test("persistent source-history schema and journal APIs stay retired", () => {
  assert.equal(
    existsSync(new URL(`../schemas/${retiredSchema}`, import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL("../fixtures/v3/source-history.current.json", import.meta.url)),
    false,
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(JSON.stringify(packageJson).includes(retiredSchema), false);
  for (const retiredExport of [
    "appendSourceHistoryOperations",
    "applySourceHistoryAction",
    "createEmptySourceHistory",
    "createSourceActionId",
    "normalizeSourceHistory",
    "sourceHistoryCapabilities",
  ]) {
    assert.equal(retiredExport in sourceHistory, false, retiredExport);
  }
});
