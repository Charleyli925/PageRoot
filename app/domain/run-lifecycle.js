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

function progressContext(run, handoffStatus) {
  const completionObserved = hasObservedCompletion(run);
  return {
    run,
    handoffStatus,
    status: canonicalLifecycleState(run.status),
    completionObserved,
    copyFailed: handoffStatus === "failed" && !completionObserved,
    copyConfirmed: handoffStatus === "copied" || completionObserved,
  };
}

function progressPresentationCopy(
  eyebrow,
  title,
  statusLabel,
  summaryTitle,
  summaryDetail,
) {
  return {
    header: { eyebrow, title },
    statusLabel,
    summaryTitle,
    summaryDetail,
  };
}

function deriveRunProgressCopy({
  run,
  handoffStatus,
  status,
  copyFailed,
  copyConfirmed,
}) {
  if (run.requestId === "pending") {
    return progressPresentationCopy(
      "正在确认发送",
      "正在确认这次发送是否成功",
      "正在确认发送结果",
      "为避免重复任务，画布暂时保持只读",
      "源页会在后台继续核对，不会重复发送同一轮要求",
    );
  }
  if (copyFailed) {
    return progressPresentationCopy(
      "交接失败",
      "AI任务复制失败，请重新复制",
      "复制失败",
      "AI任务尚未复制",
      "请重新复制本轮要求，当前 HTML 未被修改。",
    );
  }
  if (status === "awaiting-conflict-resolution") {
    return progressPresentationCopy(
      "需要处理",
      "请选择当前 HTML",
      "需要选择当前 HTML",
      "外部文件与 AI 结果发生冲突",
      "请选择采用 AI 版本，或保留外部版本；两边都不会被静默覆盖。",
    );
  }
  if (status === "error") {
    return progressPresentationCopy(
      "处理失败",
      "返回的 HTML 无法使用",
      "需要处理",
      "源 HTML 没有被覆盖",
      "当前 HTML 没有被覆盖；返回编辑后仍可查看上轮处理",
    );
  }
  if (status === "no-change") {
    return progressPresentationCopy(
      "处理结果",
      "这次没有产生有效变化",
      "没有新版本",
      "页面与评论可以继续编辑",
      "原评论和附件都已保留，调整要求后可以重新发送",
    );
  }
  if (status === "ready-to-open") {
    const continuityNeedsReview = run.candidateAssessment?.status === "attention";
    return progressPresentationCopy(
      "AI返回结果",
      "可在审阅中对比查看修改差异",
      continuityNeedsReview ? "请先审阅" : "等待确认打开",
      "AI 改好了，先对照再决定用哪一版",
      continuityNeedsReview
        ? "HTML 可以打开，但与上一版的共同特征较少，不会直接替换当前页面"
        : "不会直接替换当前页面。",
    );
  }
  if (status === "complete") {
    return progressPresentationCopy(
      "AI返回结果",
      "最新版已打开",
      "已打开新版本",
      "最新版已经打开",
      "当前画布已经切换到新版本。",
    );
  }
  if (["validating", "committing", "recovering-transaction"].includes(status)) {
    return progressPresentationCopy(
      "AI返回结果",
      "AI 已返回，正在校验并保存",
      "正在校验并保存",
      "正在校验并保存 AI 返回结果",
      "完成前不会替换当前页面，原评论和当前 HTML 都已保留。",
    );
  }
  if (status === "processing" && copyConfirmed) {
    return progressPresentationCopy(
      "等待AI返回结果",
      "AI任务已经复制，直接粘贴给 AI Agent",
      "等待 AI 返回",
      "页面暂时只能看",
      "你的评论还在，AI 改完也不会直接覆盖。",
    );
  }
  return progressPresentationCopy(
    "等待AI返回结果",
    "正在准备并复制 AI 任务",
    handoffStatus === "copying" ? "正在复制 AI 任务" : "正在准备 AI 任务",
    "页面暂时只能看",
    "你的评论还在，AI 改完也不会直接覆盖。",
  );
}

function deriveRunProgressStepsFromContext({
  run,
  handoffStatus,
  status,
  completionObserved,
  copyFailed,
  copyConfirmed,
}) {
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
    const validationDetail = run.errorDetail || run.error || "返回的 HTML 无法使用";
    validationStep.detail = completionObserved
      ? validationDetail
      : "尚未开始";
    validationStep.state = completionObserved ? "error" : "pending";
    resultStep.label = "本轮未生成新版本";
    resultStep.detail = run.recoveryHint || "当前 HTML 保持不变";
    resultStep.state = "error";
  } else if (status === "no-change") {
    validationStep.detail = "校验完成，未发现有效差异";
    validationStep.state = "done";
    resultStep.label = "无需创建新版本";
    resultStep.detail = "当前 HTML 保持不变";
    resultStep.state = "neutral";
  } else if (status === "ready-to-open") {
    const continuityNeedsReview = run.candidateAssessment?.status === "attention";
    validationStep.detail = continuityNeedsReview
      ? "HTML 可以打开，但与上一版的连续性需要确认"
      : "HTML 健康检查与版本连续性检查完成";
    validationStep.state = continuityNeedsReview ? "attention" : "done";
    resultStep.label = continuityNeedsReview
      ? "候选版本已保留"
      : "新版本已准备好";
    resultStep.detail = continuityNeedsReview
      ? "页面变化较大，请先对比审阅再决定是否采用"
      : "旧版未被覆盖，等待你审阅或直接打开";
    resultStep.state = "current";
  } else if (status === "complete") {
    validationStep.detail = "HTML 健康检查与版本连续性检查完成";
    validationStep.state = "done";
    resultStep.label = "最新版已打开";
    resultStep.detail = "当前画布已切换到新版本";
    resultStep.state = "done";
  } else if (status === "validating") {
    validationStep.detail = "正在检查 HTML 是否可用并核对上一版连续性";
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

export function deriveRunProgressPresentation(run, handoffStatus = "idle") {
  if (!run) {
    return {
      header: null,
      statusLabel: "",
      summaryTitle: "",
      summaryDetail: "",
      steps: [],
    };
  }

  const context = progressContext(run, handoffStatus);
  return {
    ...deriveRunProgressCopy(context),
    steps: deriveRunProgressStepsFromContext(context),
  };
}

export function deriveRunProgressSteps(run, handoffStatus = "idle") {
  return deriveRunProgressPresentation(run, handoffStatus).steps;
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

export function candidateAssessmentFromRecord(value) {
  if (!isRecord(value)) return null;
  const status = String(value.status || "");
  if (!["ready", "attention", "blocked"].includes(status)) return null;
  const health = isRecord(value.health) ? value.health : {};
  const continuity = isRecord(value.continuity) ? value.continuity : {};
  return {
    status,
    issueCodes: Array.isArray(value.issueCodes)
      ? value.issueCodes.map(String).filter(Boolean)
      : [],
    health: {
      completeDocument: health.completeDocument === true,
      bodyHasContent: health.bodyHasContent === true,
    },
    continuity: {
      status: continuity.status === "related" ? "related" : "uncertain",
    },
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

const ERROR_COPY_BY_CODE = new Map([
  ["INCOMPLETE_HTML", "返回的 HTML 不完整，当前页面没有被覆盖。"],
  ["HTML_DOCUMENT_INCOMPLETE", "返回的 HTML 不完整，无法打开。"],
  ["HTML_BODY_EMPTY", "返回的 HTML 没有可显示的页面内容。"],
  ["OUTPUT_HASH_MISMATCH", "返回文件在完成后发生了变化，当前 HTML 没有被覆盖。"],
  ["BASE_SNAPSHOT_HASH_MISMATCH", "本轮基准 HTML 与提交时不一致，当前 HTML 没有被覆盖。"],
  ["COMPARISON_HASH_MISMATCH", "返回结果与完成记录不一致，当前 HTML 没有被覆盖。"],
  ["COMPLETION_IDENTITY_MISMATCH", "返回结果不属于当前这一轮，当前 HTML 没有被覆盖。"],
  ["OUTPUT_MANAGED_META_MISMATCH", "返回结果的页面身份与当前项目不一致，当前 HTML 没有被覆盖。"],
  ["OUTPUT_PROTOCOL_VIOLATION", "返回文件不符合本轮约定，当前 HTML 没有被覆盖。"],
  ["UNEXPECTED_ATTEMPT_OUTPUT", "本轮返回了约定之外的文件，当前 HTML 没有被覆盖。"],
  ["UNEXPECTED_OUTPUT_FILE", "本轮返回了约定之外的文件，当前 HTML 没有被覆盖。"],
  ["HASH_MISMATCH", "返回内容与校验记录不一致，当前页面没有被覆盖。"],
  ["PROTOCOL_FIELD_MISSING", "返回结果缺少必要字段，当前页面没有被覆盖。"],
  ["CANDIDATE_UNUSABLE", "返回的 HTML 无法作为完整页面使用，当前页面没有被覆盖。"],
  ["CANDIDATE_HASH_MISMATCH", "返回内容与校验记录不一致，当前页面没有被覆盖。"],
]);

const ERROR_CODE_ALIAS = new Map([
  ["CANDIDATE_UNUSABLE", "PROTOCOL_FIELD_MISSING"],
  ["CANDIDATE_HASH_MISMATCH", "HASH_MISMATCH"],
  ["FROZEN_INPUT_HASH_MISMATCH", "HASH_MISMATCH"],
  ["REQUEST_OUTPUT_CHANGED", "HASH_MISMATCH"],
]);

function localizedRunError(rawError, completionObserved) {
  const error = isRecord(rawError) ? rawError : {};
  const rawCode = isRecord(rawError) ? String(error.code || error.errorCode || "") : "";
  const code = ERROR_CODE_ALIAS.get(rawCode) || rawCode;
  const rawMessage = isRecord(rawError)
    ? String(error.message || "")
    : String(rawError || "");
  const mapped = ERROR_COPY_BY_CODE.get(code) || ERROR_COPY_BY_CODE.get(rawCode);
  const detail = String(error.errorDetail || error.detail || "");
  const recoveryHint = String(error.recoveryHint || "");
  const errorPreview = String(error.errorPreview || "").slice(0, 500);
  if (mapped) {
    return {
      message: mapped,
      code,
      ...(detail ? { errorDetail: detail } : {}),
      ...(recoveryHint ? { recoveryHint } : {}),
      ...(errorPreview ? { errorPreview } : {}),
    };
  }
  if (/^[\s\S]*[\u3400-\u9fff][\s\S]*$/u.test(rawMessage)) {
    return {
      message: rawMessage,
      code,
      ...(detail ? { errorDetail: detail } : {}),
      ...(recoveryHint ? { recoveryHint } : {}),
      ...(errorPreview ? { errorPreview } : {}),
    };
  }
  return {
    message: completionObserved
      ? "返回的 HTML 无法安全采用，当前页面没有被覆盖。"
      : "本轮没有收到可用的完成结果，页面和评论仍然保留。",
    code,
    ...(detail ? { errorDetail: detail } : {}),
    ...(recoveryHint ? { recoveryHint } : {}),
    ...(errorPreview ? { errorPreview } : {}),
  };
}

export function activeRunFromRecord(raw) {
  if (!isRecord(raw)) return null;
  const conflict = isRecord(raw.conflict) ? raw.conflict : raw;
  const requestId = String(raw.requestId || "");
  if (!requestId) return null;
  const candidateVersionId = String(raw.candidateVersionId || "");
  const candidateVersionOrdinal = Number(raw.candidateVersionOrdinal);
  const status = canonicalLifecycleState(
    raw.status || raw.lifecycleState || "processing",
  );
  const completionObserved = raw.completionObserved === true
    || COMPLETION_OBSERVED.has(status);
  const localizedError = raw.error
    ? localizedRunError(raw.error, completionObserved)
    : null;
  const candidateAssessment = candidateAssessmentFromRecord(
    raw.candidateAssessment,
  );
  return {
    projectId: String(raw.projectId || ""),
    documentId: String(raw.documentId || ""),
    requestId,
    attemptId: String(raw.attemptId || "attempt_001"),
    requestPath: String(raw.requestPath || ""),
    attemptPath: String(raw.attemptPath || ""),
    handoffMessage: String(raw.handoffMessage || ""),
    status,
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
    ...(localizedError?.message ? { error: localizedError.message } : {}),
    ...(localizedError?.code ? { errorCode: localizedError.code } : {}),
    ...(localizedError?.errorDetail ? { errorDetail: localizedError.errorDetail } : {}),
    ...(localizedError?.recoveryHint ? { recoveryHint: localizedError.recoveryHint } : {}),
    ...(localizedError?.errorPreview ? { errorPreview: localizedError.errorPreview } : {}),
    ...(completionObserved ? { completionObserved: true } : {}),
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
    ...(candidateAssessment ? { candidateAssessment } : {}),
  };
}
