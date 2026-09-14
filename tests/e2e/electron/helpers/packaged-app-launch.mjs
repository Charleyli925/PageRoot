import {
  cpSync,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoAncestorDependencyTree(appPath) {
  let cursor = path.dirname(appPath);
  const filesystemRoot = path.parse(cursor).root;
  while (true) {
    const nodeModules = path.join(cursor, "node_modules");
    if (existsSync(nodeModules)) {
      throw new Error(
        `Packaged launch isolation contains an ancestor node_modules directory: ${nodeModules}`,
      );
    }
    if (cursor === filesystemRoot) break;
    cursor = path.dirname(cursor);
  }
}

export function stagePackagedApplicationForLaunch({
  appPath,
  isolationRoot,
}) {
  if (!path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("Packaged launch source must be an absolute .app path.");
  }
  if (!path.isAbsolute(isolationRoot)) {
    throw new Error("Packaged launch isolation root must be absolute.");
  }
  const source = realpathSync(appPath);
  const root = realpathSync(isolationRoot);
  if (!lstatSync(source).isDirectory() || isInside(source, root)) {
    throw new Error("Packaged launch isolation root must be outside the source application.");
  }
  const destination = path.join(root, path.basename(source));
  if (existsSync(destination)) {
    throw new Error(`Packaged launch destination already exists: ${destination}`);
  }
  assertNoAncestorDependencyTree(destination);
  cpSync(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  const stagedAppPath = realpathSync(destination);
  assertNoAncestorDependencyTree(stagedAppPath);
  return Object.freeze({
    appPath: stagedAppPath,
    cwd: path.dirname(stagedAppPath),
  });
}
