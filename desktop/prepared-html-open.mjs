import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { ProjectFileError } from "./project-files.mjs";

export const PREPARED_OPEN_STATES = Object.freeze([
  "prepared",
  "committing",
  "committed",
  "finalized",
  "canceled",
]);

export const PREPARED_OPEN_CLASSIFICATIONS = Object.freeze([
  "managed-project",
  "known-external",
  "new-external",
]);

export const PREPARED_OPEN_ACTIONS = Object.freeze([
  "import-new",
  "continue-current",
  "open-managed",
]);

const PREPARED_STATE_SET = new Set(PREPARED_OPEN_STATES);
const CLASSIFICATION_SET = new Set(PREPARED_OPEN_CLASSIFICATIONS);
const ACTION_SET = new Set(PREPARED_OPEN_ACTIONS);

function invalidRequest(message = "这次打开请求无效。") {
  return new ProjectFileError("INVALID_PREPARED_OPEN_REQUEST", message);
}

export function assertExactPayload(
  payload,
  allowedKeys,
  {
    code = "INVALID_PREPARED_OPEN_REQUEST",
    message = "这次打开请求无效。",
  } = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProjectFileError(code, message);
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new ProjectFileError(code, message);
  }
  return payload;
}

export function formatProjectsRootLabel(projectsRoot, {
  homedir = os.homedir(),
  pathApi = path,
} = {}) {
  if (typeof projectsRoot !== "string" || !projectsRoot.trim()) {
    return "文稿 › PageRoot › 项目";
  }
  const resolved = pathApi.resolve(projectsRoot);
  const home = typeof homedir === "string" && homedir
    ? pathApi.resolve(homedir)
    : "";
  const defaultRoot = home
    ? pathApi.resolve(pathApi.join(home, "Documents", "PageRoot", "项目"))
    : "";
  if (home && resolved === defaultRoot) {
    return "文稿 › PageRoot › 项目";
  }
  const display = home && (
    resolved === home || resolved.startsWith(`${home}${pathApi.sep}`)
  )
    ? `~${resolved.slice(home.length) || pathApi.sep}`
    : resolved;
  return display.split(/[/\\]/u).filter(Boolean).join(" › ");
}

export async function resolveOpenDialogDefaultPath({
  projectsRoot,
  documentsRoot,
  lstat,
} = {}) {
  const fallback = typeof documentsRoot === "string" && documentsRoot.trim()
    ? path.resolve(documentsRoot)
    : null;
  if (
    typeof projectsRoot !== "string"
    || !projectsRoot.trim()
    || typeof lstat !== "function"
  ) return fallback;
  const resolved = path.resolve(projectsRoot);
  const information = await lstat(resolved).catch(() => null);
  if (!information?.isDirectory?.() || information.isSymbolicLink?.()) {
    return fallback;
  }
  return resolved;
}

export function assertCommitAction({
  classification,
  action,
  deleteOriginal = false,
} = {}) {
  if (action === "view-initial") {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_ACTION_UNSUPPORTED",
      "这条打开确认不提供查看初始版本。",
    );
  }
  if (!CLASSIFICATION_SET.has(classification) || !ACTION_SET.has(action)) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_ACTION_INVALID",
      "打开确认动作无效。",
    );
  }
  if (classification === "new-external" && action !== "import-new") {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_ACTION_MISMATCH",
      "新的外部 HTML 只能选择导入并打开。",
    );
  }
  if (classification === "known-external" && action !== "continue-current") {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_ACTION_MISMATCH",
      "已导入的原文件只能继续当前项目。",
    );
  }
  if (classification === "managed-project" && action !== "open-managed") {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_ACTION_MISMATCH",
      "已登记项目文件直接打开。",
    );
  }
  if (deleteOriginal && action !== "import-new") {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
      "只有首次导入才能在成功后删除原文件。",
    );
  }
}

export function publicFactsFromClassification(classified, {
  sourceFileName,
  projectsRootLabel,
} = {}) {
  if (!classified || typeof classified !== "object") return Object.freeze({});
  if (classified.kind === "managed-project" || classified.classification === "managed-project") {
    return Object.freeze({});
  }
  if (classified.kind === "known-external" || classified.classification === "known-external") {
    return Object.freeze({
      sourceFileName: String(sourceFileName || classified.sourceFileName || ""),
      projectName: String(classified.projectName || ""),
      currentBasedOnVersionId: classified.currentBasedOnVersionId || null,
      currentBasedOnOrdinal: Number(classified.currentBasedOnOrdinal) || 0,
      latestOfficialVersionId: classified.latestOfficialVersionId || null,
      latestOfficialOrdinal: Number(classified.latestOfficialOrdinal) || 0,
      currentDiffersFromBase: classified.currentDiffersFromBase === true,
      sourceRelation: classified.sourceRelation === "changed" ? "changed" : "unchanged",
    });
  }
  return Object.freeze({
    sourceFileName: String(
      classified.sourceFileName || sourceFileName || "",
    ),
    visibleV1FileName: String(classified.visibleV1FileName || ""),
    projectsRootLabel: String(
      classified.projectsRootLabel || projectsRootLabel || "文稿 › PageRoot › 项目",
    ),
  });
}

export function publicPreparedDescriptor(intent) {
  if (!intent || typeof intent.requestId !== "string" || !intent.requestId) {
    return null;
  }
  const classification = intent.classification;
  const facts = intent.publicFacts || {};
  if (classification === "managed-project") {
    return Object.freeze({
      requestId: intent.requestId,
      classification: "managed-project",
    });
  }
  if (classification === "known-external") {
    return Object.freeze({
      requestId: intent.requestId,
      classification: "known-external",
      sourceFileName: String(facts.sourceFileName || ""),
      projectName: String(facts.projectName || ""),
      currentBasedOnVersionId: facts.currentBasedOnVersionId || null,
      currentBasedOnOrdinal: Number(facts.currentBasedOnOrdinal) || 0,
      latestOfficialVersionId: facts.latestOfficialVersionId || null,
      latestOfficialOrdinal: Number(facts.latestOfficialOrdinal) || 0,
      currentDiffersFromBase: facts.currentDiffersFromBase === true,
      sourceRelation: facts.sourceRelation === "changed" ? "changed" : "unchanged",
    });
  }
  if (classification === "new-external") {
    return Object.freeze({
      requestId: intent.requestId,
      classification: "new-external",
      sourceFileName: String(facts.sourceFileName || ""),
      visibleV1FileName: String(facts.visibleV1FileName || ""),
      projectsRootLabel: String(
        facts.projectsRootLabel || "文稿 › PageRoot › 项目",
      ),
    });
  }
  return null;
}

function copyOpenTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const exactSourcePath = String(value.exactSourcePath || "");
  if (!exactSourcePath) return null;
  return Object.freeze({
    ...value,
    exactSourcePath,
  });
}

export function createPreparedHtmlOpenStore({
  createRequestId = randomUUID,
} = {}) {
  const intents = new Map();

  const requireIntent = (requestId, allowedStates) => {
    const intent = intents.get(String(requestId || ""));
    if (!intent) {
      throw new ProjectFileError(
        "EXTERNAL_OPEN_REQUEST_EXPIRED",
        "这次打开请求已经失效，请重新选择文件。",
      );
    }
    if (allowedStates && !allowedStates.has(intent.state)) {
      throw new ProjectFileError(
        "EXTERNAL_OPEN_REQUEST_EXPIRED",
        "这次打开请求已经失效，请重新选择文件。",
      );
    }
    return intent;
  };

  return Object.freeze({
    prepare({
      requestId,
      sourcePath,
      classifiedAtSha256,
      classification,
      boundProjectId = null,
      openTarget = null,
      publicFacts = {},
    } = {}) {
      const nextRequestId = String(requestId || createRequestId());
      if (!nextRequestId) throw invalidRequest();
      if (typeof sourcePath !== "string" || !sourcePath) {
        throw invalidRequest("外部 HTML 路径无效。");
      }
      if (!CLASSIFICATION_SET.has(classification)) {
        throw invalidRequest("打开分类无效。");
      }
      if (
        typeof classifiedAtSha256 !== "string"
        || !/^sha256:[a-f0-9]{64}$/u.test(classifiedAtSha256)
      ) {
        throw invalidRequest("打开分类缺少完整内容校验。");
      }
      const intent = {
        requestId: nextRequestId,
        sourcePath,
        classifiedAtSha256,
        classification,
        boundProjectId: boundProjectId ? String(boundProjectId) : null,
        openTarget: copyOpenTarget(openTarget),
        publicFacts: Object.freeze({ ...publicFacts }),
        state: "prepared",
        action: null,
        deleteOriginal: false,
        imported: false,
        commitReceipt: null,
        originalDisposition: "kept",
      };
      intents.set(nextRequestId, intent);
      return publicPreparedDescriptor(intent);
    },
    peek(requestId) {
      return intents.get(String(requestId || "")) || null;
    },
    findPreparedBySourcePath(sourcePath) {
      const needle = String(sourcePath || "");
      if (!needle) return null;
      for (const intent of intents.values()) {
        if (intent.sourcePath !== needle) continue;
        if (intent.state === "prepared" || intent.state === "committing") {
          return intent;
        }
      }
      return null;
    },
    publicDescriptor(requestId) {
      return publicPreparedDescriptor(intents.get(String(requestId || "")));
    },
    cancel(requestId) {
      const intent = intents.get(String(requestId || ""));
      if (!intent) return false;
      if (
        intent.state === "committed"
        || intent.state === "finalized"
        || intent.state === "committing"
      ) {
        return false;
      }
      intent.state = "canceled";
      return true;
    },
    cancelOthers(keepRequestId) {
      const keep = String(keepRequestId || "");
      let canceled = 0;
      for (const [requestId, intent] of intents) {
        if (requestId === keep) continue;
        if (
          intent.state === "committed"
          || intent.state === "finalized"
          || intent.state === "committing"
        ) {
          continue;
        }
        intent.state = "canceled";
        canceled += 1;
      }
      return canceled;
    },
    beginCommit(requestId, { action, deleteOriginal = false } = {}) {
      const intent = requireIntent(requestId, new Set(["prepared"]));
      assertCommitAction({
        classification: intent.classification,
        action,
        deleteOriginal,
      });
      intent.state = "committing";
      intent.action = action;
      intent.deleteOriginal = deleteOriginal === true;
      return intent;
    },
    completeCommit(requestId, receipt) {
      const intent = requireIntent(
        requestId,
        new Set(["committing", "committed"]),
      );
      if (intent.state === "committed" && intent.commitReceipt) {
        return intent.commitReceipt;
      }
      intent.state = "committed";
      intent.imported = receipt?.imported === true;
      intent.commitReceipt = Object.freeze({ ...(receipt || {}) });
      return intent.commitReceipt;
    },
    failCommit(requestId) {
      const intent = intents.get(String(requestId || ""));
      if (!intent || intent.state !== "committing") return false;
      intent.state = "prepared";
      intent.action = null;
      intent.deleteOriginal = false;
      return true;
    },
    recordDisposition(requestId, disposition) {
      const intent = requireIntent(
        requestId,
        new Set(["committed", "finalized"]),
      );
      if (intent.state === "finalized") return intent.originalDisposition;
      const next = disposition === "trashed" || disposition === "trash-failed"
        ? disposition
        : "kept";
      intent.originalDisposition = next;
      intent.state = "finalized";
      return next;
    },
    shouldTrash(requestId) {
      const intent = intents.get(String(requestId || ""));
      return Boolean(
        intent
        && intent.state === "committed"
        && intent.imported === true
        && intent.deleteOriginal === true
        && intent.action === "import-new"
        && intent.originalDisposition === "kept",
      );
    },
  });
}

export function publicExternalOpenRequest(request) {
  if (!request || typeof request.requestId !== "string" || !request.requestId) {
    return null;
  }
  return Object.freeze({ requestId: request.requestId });
}

export function isPreparedOpenState(value) {
  return PREPARED_STATE_SET.has(value);
}
