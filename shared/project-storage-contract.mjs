import path from "node:path";

import {
  PRODUCT_CONTROL_DIRECTORY_NAME,
  PRODUCT_IMPORT_TEMP_PREFIX,
  PRODUCT_NON_REPLACE_TEMP_PREFIX,
  PRODUCT_REGISTRY_FILE_NAME,
  PRODUCT_REGISTRY_LOCK_FILE_NAME,
} from "./product-identity.mjs";

/** Pure project-layout helpers. These functions never touch the filesystem. */
export const PROJECT_CONTROL_DIRECTORY_NAME = PRODUCT_CONTROL_DIRECTORY_NAME;
export const PROJECT_REGISTRY_FILE_NAME = PRODUCT_REGISTRY_FILE_NAME;
export const PROJECT_REGISTRY_LOCK_FILE_NAME = PRODUCT_REGISTRY_LOCK_FILE_NAME;
export const PROJECT_IMPORT_TEMP_PREFIX = PRODUCT_IMPORT_TEMP_PREFIX;
export const PROJECT_NON_REPLACE_TEMP_PREFIX = PRODUCT_NON_REPLACE_TEMP_PREFIX;

export function projectControlRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), PROJECT_CONTROL_DIRECTORY_NAME);
}

/** Return a path below the project control directory without repeating its
 * product-owned name at each call site. Callers still own validation of the
 * relative segments through the existing path-safety layer. */
export function projectControlPath(projectRoot, ...segments) {
  return path.join(projectControlRoot(projectRoot), ...segments);
}

export function projectSubmissionsRoot(projectRoot) {
  return projectControlPath(projectRoot, "submissions");
}

export function projectRegistryPath(projectsRoot) {
  return path.join(path.resolve(projectsRoot), PROJECT_REGISTRY_FILE_NAME);
}

export function projectRegistryLockPath(projectsRoot) {
  return path.join(path.resolve(projectsRoot), PROJECT_REGISTRY_LOCK_FILE_NAME);
}

export function importTemporaryName(stem) {
  return `${PROJECT_IMPORT_TEMP_PREFIX}${String(stem || "import")}`;
}

export function nonReplaceTemporaryName(stem) {
  return `${PROJECT_NON_REPLACE_TEMP_PREFIX}${String(stem || "file")}`;
}
