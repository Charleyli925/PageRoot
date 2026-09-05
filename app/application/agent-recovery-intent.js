// Recovery intent is a destination, not an execution grant. It never carries
// Keys, tokens or authorization URLs. Workbench holds the live copy in memory.

const SURFACES = new Set(["sidebar", "settings", "send"]);
const PROVIDER_IDS = new Set(["pageroot", "qoder", "codex"]);
const TARGET_FIELDS = new Set(["apiKey", "login", "model", "install"]);
const KNOWN_KEYS = new Set([
  "originSurface",
  "projectId",
  "documentId",
  "requestId",
  "attemptId",
  "providerId",
  "targetField",
  "errorKind",
  "draftIdentity",
  "configurationGeneration",
]);

function boundedText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function optionalIdentity(value) {
  const text = boundedText(value, 80);
  return text || null;
}

export function createAgentRecoveryIntent(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("恢复意图无效。");
  }
  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new TypeError("恢复意图含有不能保存的字段。");
    }
  }
  const providerId = PROVIDER_IDS.has(input.providerId) ? input.providerId : null;
  const targetField = TARGET_FIELDS.has(input.targetField) ? input.targetField : null;
  const generation = Number(input.configurationGeneration);
  return Object.freeze({
    originSurface: SURFACES.has(input.originSurface) ? input.originSurface : "sidebar",
    projectId: optionalIdentity(input.projectId),
    documentId: optionalIdentity(input.documentId),
    requestId: optionalIdentity(input.requestId),
    attemptId: optionalIdentity(input.attemptId),
    providerId,
    targetField,
    errorKind: optionalIdentity(input.errorKind),
    draftIdentity: optionalIdentity(input.draftIdentity),
    configurationGeneration: Number.isInteger(generation) ? generation : null,
  });
}

export function recoveryIntentMatchesDocument(intent, {
  projectId = null,
  documentId = null,
} = {}) {
  if (!intent?.projectId || !intent?.documentId) return false;
  return intent.projectId === projectId && intent.documentId === documentId;
}

export function sidebarRecoveryBar({
  intent = null,
  catalogStatus = "unavailable",
  credentialKind = null,
  currentProjectId = null,
  currentDocumentId = null,
} = {}) {
  if (!intent) return null;
  const sameDocument = recoveryIntentMatchesDocument(intent, {
    projectId: currentProjectId,
    documentId: currentDocumentId,
  });
  if (catalogStatus === "ready") {
    if (!sameDocument) {
      return Object.freeze({
        kind: "restored-elsewhere",
        title: "连接已恢复",
        detail: "返回原任务后可以重新发送。",
        primary: Object.freeze({ id: "return-original-task", label: "返回原任务" }),
        secondary: null,
      });
    }
    return Object.freeze({
      kind: "restored",
      title: "连接已恢复",
      detail: "页面和本轮要求已保留。",
      primary: Object.freeze({ id: "resend-agent", label: "重新发送" }),
      secondary: Object.freeze({ id: "dismiss-recovery", label: "结束本轮" }),
    });
  }
  const keyPath = intent.targetField === "apiKey" || credentialKind === "api-token";
  return Object.freeze({
    kind: "repair",
    title: keyPath ? "API Key 已失效" : "需要重新连接",
    detail: "页面和本轮要求已保留。",
    primary: Object.freeze({
      id: "repair-agent-connection",
      label: keyPath ? "更换 API Key" : "重新登录",
    }),
    secondary: Object.freeze({ id: "dismiss-recovery", label: "结束本轮" }),
  });
}
