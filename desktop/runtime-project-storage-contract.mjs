import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The Bridge keeps the shared contract in Resources/shared, while the
// Electron main process lives inside app.asar. Resolve the same source-owned
// module from its real runtime location instead of assuming that a resource
// copied outside app.asar is also importable from the archive.
const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = process.defaultApp === true || typeof process.resourcesPath !== "string"
  ? path.resolve(desktopRoot, "..", "shared")
  : path.join(process.resourcesPath, "shared");
const contract = await import(
  pathToFileURL(path.join(sharedRoot, "project-storage-contract.mjs")).href,
);

export const {
  PROJECT_CONTROL_DIRECTORY_NAME,
  PROJECT_REGISTRY_FILE_NAME,
  PROJECT_REGISTRY_LOCK_FILE_NAME,
  PROJECT_IMPORT_TEMP_PREFIX,
  PROJECT_NON_REPLACE_TEMP_PREFIX,
  projectControlRoot,
  projectControlPath,
  projectSubmissionsRoot,
  projectRegistryPath,
  projectRegistryLockPath,
  importTemporaryName,
  nonReplaceTemporaryName,
} = contract;
