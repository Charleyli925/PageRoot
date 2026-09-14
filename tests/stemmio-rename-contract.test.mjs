import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(productRoot, relativePath), "utf8");
}

const CURRENT_CONTRACT_FILES = [
  "app/domain/edit-runtime-contract.js",
  "app/components/html-preview-sandbox.js",
  "bridge/workspace-bridge.mjs",
  "desktop/main.mjs",
  "desktop/preload.mjs",
  "desktop/preview-protocol.mjs",
  "desktop/edit-runtime-protocol.mjs",
  "desktop/runtime-environment.mjs",
  "shared/conversation.mjs",
  "shared/editable-island.mjs",
  "shared/openai-compatible-vendors.mjs",
  "worker/index.ts",
  "scripts/developer-preview.mjs",
  "scripts/packaged-app-identity.mjs",
  "package.json",
  "package-lock.json",
];

const RETIRED_PRODUCT_IDENTIFIERS = /(?:PageRoot|pageroot|PAGEROOT|HTML AI|HTML_AI|pr1_|com\.htmlai\.workbench|pageroot\.local|html-change\.local|html-app:|x-html-ai-bridge-token)/u;

function removeContractExceptions(contents) {
  return contents
    // The public source repository intentionally keeps its historical name.
    .replace(/https:\/\/github\.com\/Charleyli925\/PageRoot[^\s"'`)]*/gu, "")
    .replace(/"repo"\s*:\s*"PageRoot"/gu, "")
    // Page-root is a semantic HTML selection term, not the product identity.
    .replace(/isPageRoot(?:Element|Selection)?/gu, "")
    // Persisted source metadata and authored source markers are byte-preserved
    // HTML contracts, not current product namespaces.
    .replace(/data-html-ai-source-node-id/gu, "")
    .replace(/html-ai-(?:document-id|version-id|version-label|based-on-version-id|request-id)/gu, "")
    // This comment documents the retained v1 projection boundary.
    .replace(/historical PageRoot actor contract/gu, "")
    // Existing annotated release tags retain their immutable pre-cutover
    // message; the preview baseline parser accepts that exact form.
    .replace(/PageRoot \$\{version\}/gu, "");
}

test("current Stemmio contracts have no unexplained retired product identifiers", async () => {
  const entries = await Promise.all(CURRENT_CONTRACT_FILES.map(async (relativePath) => ({
    relativePath,
    contents: removeContractExceptions(await source(relativePath)),
  })));
  for (const { relativePath, contents } of entries) {
    assert.doesNotMatch(
      contents,
      RETIRED_PRODUCT_IDENTIFIERS,
      `${relativePath} contains an unexplained retired product identifier`,
    );
  }
});

test("the frozen Stemmio identity and storage contracts are packaged atomically", async () => {
  const [identity, storage, schema, packageText, previewProtocol, editRuntime] = await Promise.all([
    source("shared/product-identity.mjs"),
    source("shared/project-storage-contract.mjs"),
    source("schemas/stemmio-element-identity.v1.schema.json"),
    source("package.json"),
    source("desktop/preview-protocol.mjs"),
    source("app/domain/edit-runtime-contract.js"),
  ]);

  assert.match(identity, /PRODUCT_NAME = "Stemmio"/u);
  assert.match(identity, /PRODUCT_TECHNICAL_NAME = "stemmio"/u);
  assert.match(identity, /PRODUCT_BUNDLE_ID = "com\.stemmio\.app"/u);
  assert.match(identity, /PRODUCT_PREVIEW_BUNDLE_ID = "com\.stemmio\.app\.developer-preview"/u);
  assert.match(identity, /PRODUCT_CONTROL_DIRECTORY_NAME = "\.stemmio"/u);
  assert.match(storage, /PROJECT_REGISTRY_FILE_NAME = PRODUCT_REGISTRY_FILE_NAME/u);
  assert.match(storage, /PROJECT_IMPORT_TEMP_PREFIX = PRODUCT_IMPORT_TEMP_PREFIX/u);
  assert.match(schema, /https:\/\/stemmio\.local\/schemas\/stemmio-element-identity\.v1\.schema\.json/u);
  assert.match(schema, /\^sm1_/u);
  assert.match(packageText, /"name": "stemmio"/u);
  assert.match(packageText, /"appId": "com\.stemmio\.app"/u);
  assert.match(packageText, /"productName": "Stemmio"/u);
  assert.match(packageText, /"from": "shared\/product-identity\.mjs"/u);
  assert.match(packageText, /"from": "shared\/project-storage-contract\.mjs"/u);
  assert.match(packageText, /"conversation\.v3\.schema\.json"/u);
  assert.match(previewProtocol, /stemmio-preview/gu);
  assert.match(editRuntime, /stemmio-edit-runtime/gu);
  assert.match(await source("shared/editable-island.mjs"), /data-stemmio-editing/u);
});

test("legacy management roots and channel variables are rejected rather than redirected", async () => {
  const [runtime, pathSafety, catalog] = await Promise.all([
    source("desktop/runtime-environment.mjs"),
    source("bridge/project-file-repository/path-safety.mjs"),
    source("bridge/agent/catalog/agent-catalog.mjs"),
  ]);
  assert.doesNotMatch(runtime, /process\.env\.PAGEROOT_|PAGEROOT_RUNTIME_CHANNEL/u);
  assert.doesNotMatch(pathSafety, /process\.env\.PAGEROOT_|PAGEROOT_PROJECT_FILES_ROOT|\.pageroot-new-/u);
  assert.doesNotMatch(catalog, /~\/\.pageroot|PAGEROOT_AGENTS_ROOT/u);
  assert.match(runtime, /STEMMIO_RUNTIME_CHANNEL/u);
  assert.match(pathSafety, /PROJECT_NON_REPLACE_TEMP_PREFIX/u);
  assert.match(pathSafety, /PRODUCT_PROJECTS_DIRECTORY_NAME/u);
  assert.match(catalog, /PRODUCT_ENV\.AGENTS_ROOT/u);
});
