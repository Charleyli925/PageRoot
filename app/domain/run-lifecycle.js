export const CANONICAL_LIFECYCLE_STATES = Object.freeze([
  "editing",
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "ready",
  "no-change",
  "complete",
  "cancelled",
  "error",
]);

const CANONICAL = new Set(CANONICAL_LIFECYCLE_STATES);
const LOCKED = new Set([
  "submitting",
  "processing",
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
]);
const COMPLETION_OBSERVED = new Set([
  "validating",
  "committing",
  "ready-to-open",
  "awaiting-conflict-resolution",
  "recovering-transaction",
  "no-change",
  "complete",
]);
const LEGACY_DECODER = new Map([
  ["waiting", "processing"],
  ["importing", "validating"],
  ["result-ready", "validating"],
  ["awaiting-check-decision", "validating"],
  ["version-created", "complete"],
  ["completed", "complete"],
  ["canceled", "cancelled"],
]);

export function canonicalLifecycleState(
  value,
  { readyVersion = false, fallback = "processing" } = {},
) {
  const raw = String(value || "");
  if (
    readyVersion
    && ["version-created", "completed", "complete", "ready"].includes(raw)
  ) {
    return "ready-to-open";
  }
  const decoded = LEGACY_DECODER.get(raw) ?? raw;
  if (CANONICAL.has(decoded)) return decoded;
  return CANONICAL.has(fallback) ? fallback : "processing";
}

export function isLockedLifecycleState(value) {
  return LOCKED.has(value);
}

export function hasObservedCompletion(run) {
  return run?.completionObserved === true
    || COMPLETION_OBSERVED.has(run?.status);
}

function progressStep(key, label, detail, state) {
  return { key, label, detail, state };
}

export function deriveRunProgressSteps(run, handoffStatus = "idle") {
  if (!run) return [];

  const status = canonicalLifecycleState(run.status);
  const completionObserved = hasObservedCompletion(run);
  const copyFailed = handoffStatus === "failed" && !completionObserved;
  const copyConfirmed = handoffStatus === "copied" || completionObserved;
  const steps = [
    progressStep(
      "handoff",
      "正在准备并复制",
      handoffStatus === "copying"
        ? "正在写入并核对剪贴板"
        : run.requestId === "pending" || status === "submitting"
          ? "正在冻结本轮要求"
          : "本轮要求已冻结，等待复制交接内容",
      "current",
    ),
    progressStep(
      "ai",
      "等待 AI 完成",
      copyConfirmed ? "等待 AI 写回完成记录" : "交接完成后开始",
      copyConfirmed ? "current" : "pending",
    ),
    progressStep(
      "validation",
      "正在校验并保存",
      "等待 AI 完成后自动校验并写入本地",
      "pending",
    ),
    progressStep("result", "结果", "等待前序步骤完成", "pending"),
  ];
  const [handoffStep, aiStep, validationStep, resultStep] = steps;

  if (copyFailed) {
    Object.assign(
      handoffStep,
      progressStep(
        "handoff",
        "交接内容尚未复制",
        "剪贴板写入失败；本轮要求已安全保留",
        "error",
      ),
    );
    aiStep.detail = "尚未开始";
    validationStep.detail = "尚未开始";
    resultStep.detail = "没有生成新版本";
    return steps;
  }

  if (copyConfirmed) {
    Object.assign(
      handoffStep,
      progressStep("handoff", "已准备并复制", "交接内容已确认", "done"),
    );
  }
  if (completionObserved) {
    Object.assign(
      aiStep,
      progressStep("ai", "等待 AI 完成", "已收到完成记录", "done"),
    );
  } else if (status === "error") {
    aiStep.detail = "未收到完成记录，本轮已停止";
    aiStep.state = "error";
  }

  if (status === "awaiting-conflict-resolution") {
    validationStep.detail = "检测到外部修改与 AI 结果冲突";
    validationStep.state = "error";
    resultStep.label = "请选择当前 HTML";
    resultStep.detail = "两份内容均未被覆盖";
    resultStep.state = "current";
  } else if (status === "error") {
    validationStep.detail = completionObserved
      ? run.error || "结果未通过完整性或范围检查"
      : "尚未开始";
    validationStep.state = completionObserved ? "error" : "pending";
    resultStep.detail = "没有生成新版本";
  } else if (status === "no-change") {
    validationStep.detail = "校验完成，未发现有效差异";
    validationStep.state = "done";
    resultStep.label = "无需创建新版本";
    resultStep.detail = "当前 HTML 保持不变";
    resultStep.state = "neutral";
  } else if (status === "ready-to-open") {
    validationStep.detail = "完整性与范围校验通过";
    validationStep.state = "done";
    resultStep.label = "新版本已准备好";
    resultStep.detail = "旧版未被覆盖，等待你确认打开最新版";
    resultStep.state = "current";
  } else if (status === "complete") {
    validationStep.detail = "完整性与范围校验通过";
    validationStep.state = "done";
    resultStep.label = "最新版已打开";
    resultStep.detail = "当前画布已切换到新版本";
    resultStep.state = "done";
  } else if (status === "validating") {
    validationStep.detail = "正在核对完整性、修改范围和文件";
    validationStep.state = "current";
  } else if (status === "committing") {
    validationStep.detail = "检查已通过，正在安全保存新版本";
    validationStep.state = "current";
  } else if (status === "recovering-transaction") {
    validationStep.detail = "正在恢复并核对保存结果";
    validationStep.state = "current";
  }

  return steps;
}

export function validationReviewFromRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawStatus = String(value.status || "");
  if (
    rawStatus !== "observed"
    && rawStatus !== "pending"
    && rawStatus !== "waived"
  ) {
    return null;
  }
  return {
    // Compatibility belongs at the domain decoder boundary. The renderer only
    // sees the current model and cannot accidentally restore a retired choice.
    status: rawStatus === "pending" ? "pending" : "observed",
    hardViolationCodes: Array.isArray(value.hardViolationCodes)
      ? value.hardViolationCodes.map(String)
      : [],
    softViolationCodes: Array.isArray(value.softViolationCodes)
      ? value.softViolationCodes.map(String)
      : [],
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayVersionLabel(ordinal) {
  return Number.isSafeInteger(ordinal) && ordinal > 0
    ? `版本 ${ordinal}`
    : "下一版";
}

function safeVersionLabel(versionId) {
  const match = String(versionId || "").match(/(\d+)$/);
  return match ? `版本 ${Number(match[1])}` : String(versionId || "");
}

export function activeRunFromRecord(raw) {
  if (!isRecord(raw)) return null;
  const conflict = isRecord(raw.conflict) ? raw.conflict : raw;
  const requestId = String(raw.requestId || "");
  if (!requestId) return null;
  const candidateVersionId = String(raw.candidateVersionId || "");
  const candidateVersionOrdinal = Number(raw.candidateVersionOrdinal);
  return {
    projectId: String(raw.projectId || ""),
    documentId: String(raw.documentId || ""),
    requestId,
    attemptId: String(raw.attemptId || "attempt_001"),
    requestPath: String(raw.requestPath || ""),
    attemptPath: String(raw.attemptPath || ""),
    handoffMessage: String(raw.handoffMessage || ""),
    status: canonicalLifecycleState(
      raw.status || raw.lifecycleState || "processing",
    ),
    sourcePath: String(raw.sourcePath || ""),
    baseSnapshotSha256: String(raw.baseSnapshotSha256 || raw.sourceSha256 || ""),
    previousVersionId: raw.previousVersionId
      ? String(raw.previousVersionId)
      : null,
    basedOnVersionId: raw.basedOnVersionId
      ? String(raw.basedOnVersionId)
      : null,
    freezeCutoffRevision: Number(raw.freezeCutoffRevision || 0),
    candidateVersionId,
    candidateVersionLabel: String(
      raw.candidateDisplayVersionLabel
      || (
        Number.isSafeInteger(candidateVersionOrdinal)
        && candidateVersionOrdinal > 0
          ? displayVersionLabel(candidateVersionOrdinal)
          : null
      )
      || raw.candidateVersionLabel
      || (candidateVersionId ? safeVersionLabel(candidateVersionId) : "下一版"),
    ),
    submittedAt: String(raw.submittedAt || ""),
    ...(raw.summary ? { summary: String(raw.summary) } : {}),
    ...(Number.isFinite(Number(raw.commentCount))
      ? { commentCount: Number(raw.commentCount) }
      : {}),
    ...(Number.isFinite(Number(raw.changeEventCount))
      ? { changeEventCount: Number(raw.changeEventCount) }
      : {}),
    ...(raw.error
      ? {
          error: isRecord(raw.error)
            ? String(raw.error.message || "")
            : String(raw.error),
        }
      : {}),
    ...(raw.completionObserved === true ? { completionObserved: true } : {}),
    ...(raw.conflictId || conflict.conflictId
      ? { conflictId: String(raw.conflictId || conflict.conflictId) }
      : {}),
    ...(conflict.externalSourceSha256
      ? { externalSourceSha256: String(conflict.externalSourceSha256) }
      : {}),
    ...(conflict.candidateOutputSha256 || conflict.candidateSha256
      ? {
          candidateOutputSha256: String(
            conflict.candidateOutputSha256 || conflict.candidateSha256,
          ),
        }
      : {}),
    ...(conflict.detectedAt
      ? { conflictDetectedAt: String(conflict.detectedAt) }
      : {}),
    ...(isRecord(raw.readyPayload) ? { readyPayload: raw.readyPayload } : {}),
    ...(validationReviewFromRecord(raw.validationReview)
      ? { validationReview: validationReviewFromRecord(raw.validationReview) }
      : {}),
    ...(isRecord(raw.scopeReport) ? { scopeReport: raw.scopeReport } : {}),
  };
}
