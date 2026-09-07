// Repository-owned locator evidence. Persisted stat observations never authorize I/O.
import { randomUUID } from "node:crypto";
import { link, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { syncDirectory } from "../lifecycle-core.mjs";
import { WORKING_COPY_ID, HTML_EXTENSIONS } from "./constants.mjs";
import { ProjectFileRepositoryError } from "./errors.mjs";
import {
  assertId, copyFileIdentity, ensureProjectDirectory, regularInformation,
  readHtmlFile, sameFileIdentity, samePath,
} from "./path-safety.mjs";

export function sourceBindingPath(projectRootPath, workingCopyId) {
  assertId(workingCopyId, WORKING_COPY_ID, "workingCopyId");
  return path.join(projectRootPath, ".pageroot", "source-bindings", `${workingCopyId}.ref`);
}

export async function readSourceBinding(projectRootPath, workingCopyId) {
  const bindingPath = sourceBindingPath(projectRootPath, workingCopyId);
  const information = await regularInformation(bindingPath, "Working Copy binding", { projectRootPath });
  return information ? { bindingPath, information } : null;
}

function identityKey(information) {
  return JSON.stringify(copyFileIdentity(information));
}

// One census for migration only. It is never retained across Repository turns
// or used to authorize an HTML write. Normal opens and commits scan afresh.
export async function createSourceBindingIndex(projectRootPath, members) {
  const bindings = new Map(); const owners = new Map(); const sources = new Map();
  for (const member of members) {
    const binding = await readSourceBinding(projectRootPath, member.workingCopyId);
    if (!binding) continue;
    const key = identityKey(binding.information);
    bindings.set(member.workingCopyId, key);
    owners.set(key, [...(owners.get(key) || []), member.workingCopyId]);
  }
  for (const entry of await readdir(projectRootPath, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !HTML_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const sourcePath = path.join(projectRootPath, entry.name);
    const information = await regularInformation(sourcePath, "Working Copy", { projectRootPath });
    if (!information) continue;
    const key = identityKey(information);
    sources.set(key, [...(sources.get(key) || []), sourcePath]);
  }
  return { bindings, owners, sources };
}

export async function assertUniqueSourceBinding(projectRootPath, members, workingCopyId, binding, index = null) {
  if (!binding) return;
  const key = identityKey(binding.information);
  const candidates = index?.bindings.get(workingCopyId) === key
    ? (index.owners.get(key) || []).map((id) => ({ workingCopyId: id }))
    : members;
  for (const member of candidates) {
    if (member.workingCopyId === workingCopyId) continue;
    const other = await readSourceBinding(projectRootPath, member.workingCopyId);
    if (other && sameFileIdentity(copyFileIdentity(binding.information), copyFileIdentity(other.information))) {
      throw new ProjectFileRepositoryError("MANAGED_PATH_AMBIGUOUS", "两个工作副本共享同一绑定，请处理重复副本。");
    }
  }
}

export async function findBoundSource(projectRootPath, binding, index = null) {
  if (!binding) return null;
  const key = identityKey(binding.information);
  const indexed = index && (index.owners.has(key) || index.sources.has(key));
  const matches = [];
  const entries = indexed
    ? (index.sources.get(key) || []).map((sourcePath) => ({ name: path.basename(sourcePath), isFile: () => true, isSymbolicLink: () => false }))
    : await readdir(projectRootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !HTML_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const candidate = path.join(projectRootPath, entry.name);
    const information = await regularInformation(candidate, "Working Copy", { projectRootPath });
    if (information && sameFileIdentity(copyFileIdentity(binding.information), copyFileIdentity(information))) matches.push(candidate);
  }
  if (matches.length > 1) {
    throw new ProjectFileRepositoryError("MANAGED_PATH_AMBIGUOUS", "多个工作文件共享同一绑定，请移走多余副本后重新检查。", { candidateCount: matches.length });
  }
  return matches[0] || null;
}

export async function refreshSourceBinding(projectRootPath, workingCopyId, sourcePath, expectedSha256, { bindingIndex = null } = {}) {
  const bindingPath = sourceBindingPath(projectRootPath, workingCopyId);
  await ensureProjectDirectory(projectRootPath, path.dirname(bindingPath), "source bindings");
  const source = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath });
  if (source.sha256 !== expectedSha256) {
    throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "工作文件内容已变化，未更新绑定。");
  }
  const binding = await readSourceBinding(projectRootPath, workingCopyId);
  const boundPath = await findBoundSource(projectRootPath, binding, bindingIndex);
  if (boundPath && !samePath(boundPath, sourcePath)) {
    throw new ProjectFileRepositoryError("MANAGED_PATH_AMBIGUOUS", "登记位置与绑定指向不同工作文件，请处理重复副本。");
  }
  if (binding && sameFileIdentity(copyFileIdentity(binding.information), copyFileIdentity(source.information))) return true;
  const temporary = `${bindingPath}.${randomUUID()}.tmp`;
  try {
    try { await link(sourcePath, temporary); }
    catch (cause) {
      // A filesystem without hard links can still use the registered path and
      // full content proof. It cannot infer a rename from identical bytes.
      if (["ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS", "EPERM"].includes(cause?.code)) return false;
      throw cause;
    }
    const anchored = await readHtmlFile(temporary, "Working Copy binding", { projectRootPath });
    const current = await regularInformation(sourcePath, "Working Copy", { projectRootPath });
    if (anchored.sha256 !== expectedSha256 || !current
      || !sameFileIdentity(copyFileIdentity(source.information), copyFileIdentity(anchored.information))
      || !sameFileIdentity(copyFileIdentity(anchored.information), copyFileIdentity(current))) {
      throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "工作文件在建立绑定时被替换。");
    }
    await rename(temporary, bindingPath);
    await syncDirectory(path.dirname(bindingPath));
    return true;
  } finally {
    await unlink(temporary).catch((cause) => { if (cause?.code !== "ENOENT") throw cause; });
  }
}
