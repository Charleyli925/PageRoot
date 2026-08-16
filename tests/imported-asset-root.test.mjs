import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  forgetImportedAssetRootsForPath,
  importedAssetRootForProjectPath,
  isExternalOriginalPath,
  normalizeImportedAssetRoots,
  previewAssetSourcePath,
  rememberImportedAssetRoot,
  resolveLiveImportedAssetSource,
} from "../desktop/imported-asset-root.mjs";

test("imported asset roots persist by project folder and ignore junk", () => {
  const roots = rememberImportedAssetRoot([], {
    projectRootPath: "/projects/report",
    originalSourcePath: "/desktop/report.html",
  });
  const replaced = rememberImportedAssetRoot(roots, {
    projectRootPath: "/projects/report",
    originalSourcePath: "/desktop/moved/report.html",
  });
  assert.deepEqual(replaced, [{
    projectRootPath: "/projects/report",
    originalSourcePath: "/desktop/moved/report.html",
  }]);
  assert.deepEqual(normalizeImportedAssetRoots([
    { projectRootPath: "/projects/report", originalSourcePath: "/desktop/report.html" },
    { projectRootPath: "/projects/report", originalSourcePath: "/desktop/dup.html" },
    { not: "a root" },
    null,
  ]), [{
    projectRootPath: "/projects/report",
    originalSourcePath: "/desktop/report.html",
  }]);
});

test("working-copy switches inside a project are not treated as the original", () => {
  assert.equal(
    isExternalOriginalPath("/projects/report/report-V1.html", "/projects/report/report-V2.html"),
    false,
  );
  assert.equal(
    isExternalOriginalPath("/desktop/report.html", "/projects/report/report-V1.html"),
    true,
  );
});

test("preview asset substitution keeps the authorized project path when no original remains", () => {
  assert.equal(
    previewAssetSourcePath({
      authorizedProjectSourcePath: "/projects/report/report-V1.html",
      liveImportedAssetSourcePath: "/desktop/report.html",
    }),
    "/desktop/report.html",
  );
  assert.equal(
    previewAssetSourcePath({
      authorizedProjectSourcePath: "/projects/report/report-V1.html",
      liveImportedAssetSourcePath: null,
    }),
    "/projects/report/report-V1.html",
  );
});

test("live imported asset source falls back to the original directory after the HTML is gone", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "pageroot-imported-asset-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const originalDirectory = path.join(temporaryRoot, "原稿");
  const projectDirectory = path.join(temporaryRoot, "项目");
  await mkdir(originalDirectory, { recursive: true });
  await mkdir(projectDirectory, { recursive: true });
  const originalPath = path.join(originalDirectory, "图表报告.html");
  const projectPath = path.join(projectDirectory, "图表报告-V1.html");
  await writeFile(originalPath, "<img src=\"pixel.png\">", "utf8");
  await writeFile(path.join(originalDirectory, "pixel.png"), "png", "utf8");
  await writeFile(projectPath, "<img src=\"pixel.png\">", "utf8");

  const liveFile = await resolveLiveImportedAssetSource(originalPath);
  assert.equal(liveFile, await realpath(originalPath));

  await rm(originalPath);
  const liveDirectory = await resolveLiveImportedAssetSource(originalPath);
  assert.equal(liveDirectory, await realpath(originalDirectory));

  const remembered = rememberImportedAssetRoot([], {
    projectRootPath: await realpath(projectDirectory),
    originalSourcePath: originalPath,
  });
  const matched = await importedAssetRootForProjectPath(remembered, projectPath);
  assert.equal(matched?.originalSourcePath, originalPath);
  assert.deepEqual(
    await forgetImportedAssetRootsForPath(remembered, projectPath),
    [],
  );
});

test("confirmation CAS copy matches the product string", async () => {
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(main, /文件在确认期间被修改，没有导入。/u);
  assert.doesNotMatch(main, /确认期间这个文件已变化，请重新打开。/u);
});
