import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

// Creates leftover pre-v4 project records solely to verify the v4
// incompatibility boundary: the Electron client must ignore them and import
// the source as a fresh V1. User disk data is not deleted.
export async function seedLegacyV3Project({ isolatedUserData, sourcePath }) {
  if (!isolatedUserData || !sourcePath) {
    throw new TypeError("旧项目预置需要隔离用户目录和源 HTML 路径。");
  }
  mkdirSync(isolatedUserData, { recursive: true });
  const workspace = path.join(isolatedUserData, "workspace");
  const projectId = `project_${randomBytes(8).toString("hex")}`;
  const documentId = `doc_${randomBytes(8).toString("hex")}`;
  const createdAt = new Date().toISOString();
  const storageDirectoryName = `pre-v4-legacy__${projectId.slice(-8)}`;
  const projectRoot = path.join(workspace, "projects", storageDirectoryName);
  mkdirSync(path.join(projectRoot, "versions"), { recursive: true });
  writeFileSync(
    path.join(workspace, "project-registry.json"),
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projects: {
        [projectId]: {
          displayName: path.basename(sourcePath, path.extname(sourcePath)),
          sourcePath,
          createdAt,
          storageDirectoryName,
        },
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(projectRoot, "project.json"),
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projectId,
      documentId,
      sourcePath,
      createdAt,
      storageDirectoryName,
    }, null, 2)}\n`,
  );
  return {
    projectId,
    documentId,
    workspace,
    projectRoot,
    registered: true,
  };
}
