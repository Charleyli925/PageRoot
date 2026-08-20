import { isBridgeRequestError } from "./bridge-client.js";
import { createRunWorkflowCodecs } from "./run-workflow-codecs.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const POLL_INTERVAL_MS = 1_600;
const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";
const DELIVERY_MODES = new Set(["clipboard", "qoder-acp"]);
const NON_RETRYABLE_AGENT_ERRORS = new Set([
  "ACP_PROCESS_CLEANUP_UNCONFIRMED",
  "AGENT_DELIVERY_NOT_AUTHORIZED",
  "AGENT_RESTART_RECOVERY_REQUIRED",
  "AGENT_RETRY_BLOCKED",
  "AGENT_RETRY_OUTPUT_PRESENT",
  "AGENT_TASK_NOT_PROCESSING",
  "AGENT_TASK_POLICY_INVALID",
]);

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({
    status: "blocked",
    code: String(code),
    reason: String(reason),
  });
}

function rejected(code, reason) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function stale(identity) {
  return Object.freeze({ status: "stale", identity: Object.freeze({ ...identity }) });
}

function responseError(code, reason) {
  const error = new Error(reason);
  error.code = code;
  error.runWorkflowResponseError = true;
  return error;
}

function errorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  if (cause && typeof cause === "object" && cause.code) return String(cause.code);
  return fallback;
}

function responseMayBeUnknown(cause) {
  return Boolean(
    cause?.runWorkflowResponseError
    || !isBridgeRequestError(cause)
    || cause.outcome === "unknown",
  );
}

function validDate(clock) {
  return new Date(Math.max(0, Number(clock.now()) || 0)).toISOString();
}

function frozenArray(values) {
  return Object.freeze([...values]);
}

function copyContext(context) {
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || context.sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? context.epoch),
    }
    : {};
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
    ...target,
  });
}

function isPollable(run) {
  return Boolean(
    run?.requestId
    && run.requestId !== "pending"
    && !["cancelled", "complete", "no-change", "error"].includes(run.status),
  );
}

function agentHandoffState(run, session) {
  const state = String(session?.state || "");
  if (![
    "starting",
    "running",
    "completed",
    "failed",
    "interrupted",
    "cancelling",
    "cancelled",
  ].includes(state)) return null;
  return {
    sourcePath: run.sourcePath,
    requestId: run.requestId,
    attemptId: run.attemptId,
    mode: "qoder-acp",
    status: state,
    phase: String(session.phase || state),
    agentName: session.agentName ? String(session.agentName) : null,
    agentVersion: session.agentVersion ? String(session.agentVersion) : null,
    errorCode: session.errorCode ? String(session.errorCode) : null,
    errorMessage: session.errorMessage ? String(session.errorMessage) : null,
    retryable: session.retryable === true,
  };
}

function qoderRecoveryRequired(run, handoff) {
  return Boolean(
    run?.agentDelivery?.mode === "qoder-acp"
    && handoff?.mode === "qoder-acp"
    && handoff.requestId === run.requestId
    && handoff.attemptId === run.attemptId
    && ["failed", "interrupted"].includes(handoff.status)
    && handoff.retryable === false,
  );
}

// RunWorkflow is the PR-5 application boundary. It owns Request submission,
// authority reconciliation, polling, cancellation and conflict commands. It
// deliberately receives renderer conversion helpers and narrow Canvas/Handoff
// ports so that Workbench remains a presentation adapter.
export class RunWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #versionSession;
  #runSession;
  #documentWorkflow;
  #drain;
  #codecs;
  #canvasPort;
  #handoffPort;
  #hashPort;
  #scheduler;
  #clock;
  #listeners = new Set();
  #eventListeners = new Set();
  #timer = null;
  #pollGeneration = 0;
  #uncertainSubmissions = new Map();
  #disposed = false;

  constructor({
    bridgeClient,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    runSession,
    documentWorkflow,
    drain,
    codecs,
    ports = {},
    scheduler = globalThis,
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.createRequest !== "function"
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.status !== "function"
      || typeof bridgeClient.preflightAgent !== "function"
      || typeof bridgeClient.startAgent !== "function"
      || typeof bridgeClient.cancelActiveRun !== "function"
      || typeof bridgeClient.resolveConflict !== "function"
    ) {
      throw new TypeError("RunWorkflow requires its run Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("RunWorkflow requires registration authority.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("RunWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.update !== "function") {
      throw new TypeError("RunWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.setComments !== "function") {
      throw new TypeError("RunWorkflow requires CommentSession injection.");
    }
    if (!versionSession || !versionSession.snapshot) {
      throw new TypeError("RunWorkflow requires VersionSession injection.");
    }
    if (
      !runSession
      || typeof runSession.trackRun !== "function"
      || typeof runSession.isOperationBusy !== "function"
    ) {
      throw new TypeError("RunWorkflow requires RunSession injection.");
    }
    if (!documentWorkflow || typeof documentWorkflow.enqueueEdit !== "function") {
      throw new TypeError("RunWorkflow requires DocumentWorkflow composition.");
    }
    if (typeof drain !== "function") {
      throw new TypeError("RunWorkflow requires Controller drain authority.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("RunWorkflow requires a Canvas freeze port.");
    }
    if (typeof ports.canvas.unlock !== "function") {
      throw new TypeError("RunWorkflow CanvasPort must provide unlock.");
    }
    if (!ports.handoff || typeof ports.handoff.copy !== "function") {
      throw new TypeError("RunWorkflow requires a Handoff copy port.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("RunWorkflow requires a HashPort.");
    }
    if (
      !scheduler
      || typeof scheduler.setInterval !== "function"
      || typeof scheduler.clearInterval !== "function"
    ) {
      throw new TypeError("RunWorkflow requires an interval Scheduler.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("RunWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#versionSession = versionSession;
    this.#runSession = runSession;
    this.#documentWorkflow = documentWorkflow;
    this.#drain = drain;
    this.#codecs = createRunWorkflowCodecs(codecs);
    this.#canvasPort = {
      fencePendingEdit: ports.canvas.fencePendingEdit || (() => ({ ok: true })),
      freeze: ports.canvas.freeze,
      unlock: ports.canvas.unlock,
      normalizeComments: ports.canvas.normalizeComments || (() => (
        this.#commentSession.comments.filter(this.#codecs.commentHasContent)
      )),
    };
    this.#handoffPort = ports.handoff;
    this.#hashPort = ports.hash;
    this.#scheduler = scheduler;
    this.#clock = clock;
  }

  getSnapshot() {
    return Object.freeze({
      polling: this.#timer !== null,
      pendingReconciliations: frozenArray(this.#uncertainSubmissions.keys()),
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("RunWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("RunWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.stopPolling();
    this.#uncertainSubmissions.clear();
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  syncPolling() {
    if (this.#disposed) return;
    if (this.#hasPollingWork()) this.startPolling();
    else this.stopPolling();
  }

  startPolling() {
    if (this.#disposed || this.#timer !== null || !this.#hasPollingWork()) return;
    const generation = this.#pollGeneration;
    this.#timer = this.#scheduler.setInterval(() => {
      void this.pollNow({ generation });
    }, POLL_INTERVAL_MS);
    this.#publishSnapshot();
    void this.pollNow({ generation });
  }

  stopPolling() {
    this.#pollGeneration += 1;
    if (this.#timer !== null) {
      this.#scheduler.clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#publishSnapshot();
  }

  async pollNow({ generation = this.#pollGeneration } = {}) {
    if (!this.#isPollCurrent(generation)) return stale({ generation });
    const runs = this.#runSession.runs.filter(isPollable);
    const polls = runs.map((run) => this.#pollRun(run, generation));
    const reconciliations = [...this.#uncertainSubmissions.keys()].map(
      (sourcePath) => this.reconcileSubmission({ sourcePath, generation }),
    );
    await Promise.allSettled([...polls, ...reconciliations]);
    if (!this.#isPollCurrent(generation)) return stale({ generation });
    this.syncPolling();
    return succeeded({ runs: runs.length, reconciliations: reconciliations.length });
  }

  async submit({
    projectName = "未命名页面",
    previousVersionId = this.#versionSession.snapshot.latestVersionId,
    basedOnVersionId = this.#versionSession.snapshot.currentBasedOnVersionId,
    deadlineAt = this.#clock.now() + 60_000,
    deliveryMode = "clipboard",
  } = {}) {
    if (this.#disposed) {
      return blocked("RUN_WORKFLOW_DISPOSED", "本轮任务工作流已经停止。");
    }
    if (!DELIVERY_MODES.has(deliveryMode)) {
      return rejected("RUN_DELIVERY_MODE_INVALID", "选择的 Agent 交接方式无效。");
    }
    const sourcePath = this.#projectSession.sourcePath;
    const context = copyContext(this.#projectSession.context);
    if (!sourcePath || !context) {
      return blocked("RUN_SUBMISSION_PROJECT_UNAVAILABLE", "请先打开并建立当前 HTML 的项目资料。");
    }
    if (this.#runSession.submissionPending || this.#runSession.activeLocked) {
      return blocked("RUN_SUBMISSION_LOCKED", "当前项目正在处理上一轮要求。");
    }
    if (
      this.#commentSession.composerTarget
      && (
        this.#commentSession.composerDraft.trim()
        || this.#commentSession.composerAttachments.length > 0
      )
    ) {
      return blocked("RUN_SUBMISSION_COMMENT_DRAFT", "还有一条评论未保存。");
    }
    if (
      this.#commentSession.editSession
      && this.#codecs.commentEditSessionHasChanges(this.#commentSession.editSession)
    ) {
      return blocked("RUN_SUBMISSION_COMMENT_EDIT", "还有一条评论编辑尚未保存。");
    }
    const committed = this.#canvasPort.fencePendingEdit({
      resumeEditing: false,
      trigger: "ai",
    });
    if (!committed?.ok) {
      return blocked(
        "RUN_SUBMISSION_NATIVE_EDIT",
        committed?.reason || "请先完成当前文字输入，再发送本轮要求。",
      );
    }

    let comments = this.#commentsForSubmission();
    const commentOutcome = this.#validateComments(comments);
    if (commentOutcome) return commentOutcome;

    const submission = this.#runSession.beginSubmission({ sourcePath });
    if (!submission) {
      return blocked("RUN_SUBMISSION_BUSY", "当前项目正在准备本轮要求。");
    }
    let pendingRun = null;
    let submissionUncertain = false;
    let durableRun = null;
    let agentPreflight = null;
    try {
      if (deliveryMode === "qoder-acp") {
        agentPreflight = await this.#bridgeClient.preflightAgent({
          driver: "qoder-acp",
          trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        });
        if (agentPreflight?.status !== "ready" || !agentPreflight.preflightId) {
          throw responseError(
            "RUN_AGENT_PREFLIGHT_INVALID",
            "Qoder CLI 预检没有返回可验证结果。",
          );
        }
        if (!this.#isCurrentContext(context)) return stale(context);
      }
      const registered = await this.#ensureRegistered({
        sourcePath: context.sourcePath,
        expectedSourceSha256: this.#documentSession.sourceSha256,
      });
      if (registered?.status !== "succeeded") return registered || rejected(
        "RUN_SUBMISSION_REGISTRATION_INVALID",
        "项目资料初始化没有返回可验证结果。",
      );
      if (!this.#isCurrentContext(context)) return stale(context);

      comments = this.#commentsForSubmission();
      const registeredCommentOutcome = this.#validateComments(comments);
      if (registeredCommentOutcome) return registeredCommentOutcome;

      // No await precedes this source-authority fence. It captures the exact
      // HTML bytes and retires native editing before the Request is prepared.
      const frozen = this.#canvasPort.freeze(
        "画布还没有形成可验证的 HTML 快照，本轮不会发送。",
      );
      if (!frozen?.ok || !SHA256.test(String(frozen.sourceSha256 || ""))) {
        if (frozen?.ok) this.#canvasPort.unlock();
        return blocked(
          "RUN_SUBMISSION_FREEZE",
          frozen?.reason || "画布还没有形成可验证的 HTML 快照，本轮不会发送。",
        );
      }
      if (!this.#runSession.freezeSubmission(submission)) {
        this.#canvasPort.unlock();
        return stale(context);
      }
      const frozenHash = await this.#hashPort.sha256(String(frozen.html || ""));
      if (frozenHash !== frozen.sourceSha256 || !this.#isCurrentContext(context)) {
        this.#canvasPort.unlock();
        return rejected(
          "RUN_SUBMISSION_FREEZE_HASH_MISMATCH",
          "冻结 HTML 的内容或项目身份已经变化，本轮不会发送。",
        );
      }
      if (frozen.html !== this.#documentSession.html) {
        const enqueued = this.#documentWorkflow.enqueueEdit({
          html: frozen.html,
          mutation: frozen.pendingMutation || undefined,
          context,
        });
        if (enqueued?.status !== "succeeded") {
          this.#canvasPort.unlock();
          return enqueued || rejected(
            "RUN_SUBMISSION_DOCUMENT_EDIT",
            "当前编辑没有进入可验证的源码历史。",
          );
        }
      }
      const freezeCutoffRevision = this.#documentSession.editRevision;
      const submissionContext = Object.freeze({
        ...context,
        projectName: String(projectName || "未命名页面"),
        comments: comments.map((comment) => ({ ...comment })),
        changeEvents: this.#commentSession.changeEvents.map((event) => ({ ...event })),
        frozenSourceSha256: frozen.sourceSha256,
        freezeCutoffRevision,
      });
      pendingRun = this.#pendingRun({
        context: submissionContext,
        previousVersionId,
        basedOnVersionId,
        deliveryMode,
      });
      this.#runSession.forgetOutcome(submissionContext.sourcePath);
      this.#runSession.trackRun(pendingRun, { activate: "always" });
      this.#emitEvent({
        type: "run-submission-started",
        run: pendingRun,
        context: submissionContext,
        current: true,
      });

      const drained = await this.#drain({ boundary: "submit", deadlineAt });
      if (
        !drained?.ok
        || this.#documentSession.lastPersistedRevision !== freezeCutoffRevision
        || this.#documentSession.editRevision !== freezeCutoffRevision
      ) {
        throw responseError(
          "RUN_SUBMISSION_DRAIN_FAILED",
          drained?.ok
            ? "冻结前的最后一次修改尚未安全写入源 HTML。"
            : String(drained?.reason || "冻结边界尚未完成。"),
        );
      }
      const persistedSourceSha256 = this.#documentSession.sourceSha256;
      if (
        persistedSourceSha256 !== frozen.sourceSha256
        || !this.#isCurrentContext(context)
      ) {
        throw responseError(
          "RUN_SUBMISSION_SOURCE_MISMATCH",
          "冻结 HTML 的 Hash 与已写回源文件不一致。",
        );
      }
      const persistedComments = this.#commentsForSubmission();
      const persistedCommentOutcome = this.#validateComments(
        persistedComments,
        persistedSourceSha256,
        submissionContext.comments.length,
      );
      if (persistedCommentOutcome) {
        throw responseError(
          persistedCommentOutcome.code,
          persistedCommentOutcome.reason,
        );
      }
      const persistedEvents = this.#commentSession.changeEvents.map(
        (event) => ({ ...event }),
      );
      if (!this.#isCurrentContext(context)) {
        throw responseError(
          "RUN_SUBMISSION_CONTEXT_STALE",
          "冻结边界内的最新评论与修改审计尚未安全记录。",
        );
      }
      const request = {
        ...context,
        projectName: this.#codecs.fileStem(submissionContext.projectName),
        projectMd: this.#codecs.projectMarkdown(submissionContext.projectName),
        sourcePath: context.sourcePath,
        expectedSourceSha256: persistedSourceSha256,
        freezeCutoffRevision,
        lastPersistedRevision: this.#documentSession.lastPersistedRevision,
        summary: this.#summary(persistedComments),
        targets: this.#codecs.uniqueTargets(persistedComments)
          .map(this.#codecs.persistedTargetRef),
        instructions: persistedComments.map((comment) => ({
          instructionId: `instruction_${String(comment.commentId || "").replace(/^comment_/, "")}`,
          text: String(comment.text || "").trim()
            || "请结合本条评论所附附件完成修改。",
          targetRefs: [comment.target.id],
          attachmentRefs: (comment.attachments || []).map(
            (attachment) => attachment.attachmentId,
          ),
        })),
        comments: persistedComments.map(this.#codecs.persistedComment),
        changeEvents: persistedEvents.map(this.#codecs.persistedChangeEvent),
        agentDelivery: deliveryMode === "qoder-acp"
          ? {
              mode: "qoder-acp",
              trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
            }
          : { mode: "clipboard" },
      };
      const operationId = this.#codecs.operationKey(pendingRun);
      let dispatched = false;
      try {
        dispatched = true;
        const payload = await this.#bridgeClient.createRequest(request);
        const run = this.#runFromRequestPayload(payload);
        if (!run || !this.#runMatchesContext(run, context)) {
          throw responseError(
            "RUN_REQUEST_IDENTITY_INVALID",
            "任务已创建，但返回的 Request 身份无法核验。",
          );
        }
        durableRun = run;
      } catch (cause) {
        if (!dispatched || !responseMayBeUnknown(cause)) throw cause;
        const uncertainRun = {
          ...pendingRun,
          status: "error",
          error: "本轮任务状态暂时无法确认。当前项目保持只读，避免重复建立任务。",
        };
        this.#runSession.trackRun(uncertainRun, { activate: "always" });
        if (!this.#runSession.markSubmissionUncertain(submission)) throw cause;
        submissionUncertain = true;
        this.#uncertainSubmissions.set(context.sourcePath, {
          context,
          submission,
          pendingRun: uncertainRun,
          operationId,
        });
        this.#publishSnapshot();
        this.#emitEvent({
          type: "run-submission-uncertain",
          run: uncertainRun,
          context,
          current: this.#isCurrentRun(uncertainRun),
          cause,
        });
        const reconciled = await this.reconcileSubmission({
          sourcePath: context.sourcePath,
        });
        if (reconciled.status === "succeeded") {
          durableRun = reconciled.value.run || null;
          submissionUncertain = this.#uncertainSubmissions.has(context.sourcePath);
          if (durableRun) {
            // Reconciliation found the durable Request. Continue through the
            // ordinary handoff path without ever replaying the POST.
          } else {
            return unknown(
              operationId,
              "Request 的提交结果暂时无法确认，系统正在只读核对项目记录。",
            );
          }
        } else {
          return unknown(
            operationId,
            "Request 的提交结果暂时无法确认，系统正在只读核对项目记录。",
          );
        }
      }
      this.#runSession.trackRun(durableRun, {
        activate: this.#isCurrentRun(durableRun) ? "always" : "never",
      });
      this.#emitEvent({
        type: "run-submitted",
        run: durableRun,
        context,
        current: this.#isCurrentRun(durableRun),
      });
      this.syncPolling();
      if (deliveryMode === "qoder-acp") {
        await this.startAgent({
          run: durableRun,
          preflightId: agentPreflight.preflightId,
        });
      } else if (durableRun.handoffMessage) {
        await this.copyHandoff({ run: durableRun });
      }
      return succeeded({ run: durableRun });
    } catch (cause) {
      const message = this.#codecs.errorMessage(
        cause,
        "这次发送没有成功。页面和评论仍然保留。",
      );
      if (pendingRun && this.#runSession.hasRun(pendingRun)) {
        this.#runSession.removeRun(pendingRun);
      }
      if (this.#isCurrentContext(context)) {
        this.#canvasPort.unlock();
        const failedRun = pendingRun
          ? { ...pendingRun, status: "error", error: message }
          : null;
        if (failedRun) this.#runSession.setActiveRun(failedRun);
      }
      this.#emitEvent({
        type: "run-submission-failed",
        run: pendingRun,
        context,
        current: this.#isCurrentContext(context),
        cause,
        message,
      });
      return rejected(errorCode(cause, "RUN_SUBMISSION_REJECTED"), message);
    } finally {
      if (!submissionUncertain) this.#runSession.releaseSubmission(submission);
      this.syncPolling();
    }
  }

  async reconcileSubmission({ sourcePath = null, generation = this.#pollGeneration } = {}) {
    const entries = sourcePath
      ? [[sourcePath, this.#uncertainSubmissions.get(sourcePath)]]
      : [...this.#uncertainSubmissions.entries()];
    const outcomes = [];
    for (const [key, entry] of entries) {
      if (!entry || !this.#isPollCurrent(generation)) continue;
      const operationKey = this.#codecs.operationKey(entry.pendingRun);
      if (!this.#runSession.beginOperation("poll", operationKey)) continue;
      try {
        const payload = await this.#bridgeClient.workspace(entry.context.sourcePath);
        if (
          !this.#isPollCurrent(generation)
          || this.#uncertainSubmissions.get(key)?.submission?.token !== entry.submission.token
        ) {
          outcomes.push(stale(entry.context));
          continue;
        }
        const runtime = this.#codecs.isRecord(payload.runtimeState)
          ? payload.runtimeState
          : {};
        const conflict = this.#codecs.isRecord(runtime.conflict) ? runtime.conflict : null;
        const activeRecord = this.#codecs.isRecord(runtime.activeRun)
          ? runtime.activeRun
          : this.#codecs.isRecord(payload.activeRun)
            ? payload.activeRun
            : null;
        const recoveredRun = this.#codecs.activeRunFromRecord(
          activeRecord ? { ...activeRecord, ...(conflict ? { conflict } : {}) } : null,
        );
        if (recoveredRun && !this.#runMatchesContext(recoveredRun, entry.context)) {
          throw responseError(
            "RUN_RECONCILIATION_IDENTITY_INVALID",
            "项目记录返回的运行身份与冻结的 Request 不一致。",
          );
        }
        if (recoveredRun) {
          this.#runSession.trackRun(recoveredRun, {
            activate: this.#isCurrentRun(recoveredRun) ? "always" : "never",
            recovered: true,
          });
          this.#settleUncertainSubmission(key, entry);
          this.#emitEvent({
            type: "run-submission-reconciled",
            run: recoveredRun,
            context: entry.context,
            current: this.#isCurrentRun(recoveredRun),
          });
          outcomes.push(succeeded({ run: recoveredRun }));
          continue;
        }
        const outcome = this.#codecs.activeRunFromRecord(payload.recentRunOutcome);
        if (outcome && !this.#runMatchesContext(outcome, entry.context)) {
          throw responseError(
            "RUN_RECONCILIATION_OUTCOME_INVALID",
            "项目记录返回的完成结果与冻结的 Request 不一致。",
          );
        }
        if (outcome) {
          this.#runSession.removeRun(entry.pendingRun);
          this.#runSession.rememberOutcome(outcome);
          if (this.#isCurrentRun(outcome)) {
            this.#runSession.setActiveRun(outcome);
            this.#canvasPort.unlock();
          }
          this.#settleUncertainSubmission(key, entry);
          this.#emitEvent({
            type: "run-submission-reconciled",
            run: outcome,
            context: entry.context,
            current: this.#isCurrentRun(outcome),
          });
          outcomes.push(succeeded({ run: outcome }));
          continue;
        }
        this.#runSession.removeRun(entry.pendingRun);
        if (this.#isCurrentContext(entry.context)) {
          this.#runSession.clearActiveRun();
          this.#canvasPort.unlock();
        }
        this.#settleUncertainSubmission(key, entry);
        this.#emitEvent({
          type: "run-submission-reconciled",
          run: null,
          context: entry.context,
          current: this.#isCurrentContext(entry.context),
        });
        outcomes.push(succeeded({ run: null }));
      } catch (cause) {
        if (this.#isPollCurrent(generation)) {
          this.#emitEvent({
            type: "run-submission-reconcile-failed",
            run: entry.pendingRun,
            context: entry.context,
            current: this.#isCurrentContext(entry.context),
            cause,
          });
        }
        outcomes.push(unknown(entry.operationId, this.#codecs.errorMessage(
          cause,
          "项目记录暂时无法读取，仍将只读核对。",
        )));
      } finally {
        this.#runSession.endOperation("poll", operationKey);
      }
    }
    this.syncPolling();
    return outcomes[0] || succeeded({ run: null });
  }

  async copyHandoff({ run = this.#runSession.activeRun } = {}) {
    if (!run?.handoffMessage || !run.sourcePath || !run.requestId || run.requestId === "pending") {
      return blocked("RUN_HANDOFF_UNAVAILABLE", "当前 Request 没有可复制的交接内容。");
    }
    if (qoderRecoveryRequired(run, this.#runSession.handoffForSource(run.sourcePath))) {
      return blocked(
        "RUN_AGENT_RECOVERY_REQUIRED",
        "这轮不能安全改为复制任务。请结束本轮，再重新发送为新的 Request。",
      );
    }
    this.#runSession.publishHandoff({
      sourcePath: run.sourcePath,
      requestId: run.requestId,
      attemptId: run.attemptId,
      mode: "clipboard",
      status: "copying",
    });
    try {
      const result = await this.#handoffPort.copy({ message: run.handoffMessage, run });
      if (result?.status !== "copied" || result.copied !== true) {
        throw responseError("RUN_HANDOFF_COPY_UNCONFIRMED", "剪贴板没有确认读回成功。");
      }
      if (!this.#runSession.hasRun(run)) return stale(run);
      this.#runSession.publishHandoff({
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        mode: "clipboard",
        status: "copied",
      });
      this.#emitEvent({
        type: "run-handoff-copied",
        run,
        current: this.#isCurrentRun(run),
      });
      return succeeded({ run });
    } catch (cause) {
      if (this.#runSession.hasRun(run)) {
        this.#runSession.publishHandoff({
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          mode: "clipboard",
          status: "failed",
        });
      }
      this.#emitEvent({
        type: "run-handoff-failed",
        run,
        current: this.#isCurrentRun(run),
        cause,
        message: this.#codecs.errorMessage(
          cause,
          "这次任务还在，打开本轮后可以重新复制",
        ),
      });
      return rejected(errorCode(cause, "RUN_HANDOFF_COPY_FAILED"), this.#codecs.errorMessage(
        cause,
        "这次任务还在，打开本轮后可以重新复制",
      ));
    }
  }

  async startAgent({
    run = this.#runSession.activeRun,
    preflightId = null,
  } = {}) {
    if (!run?.sourcePath || !run.requestId || run.requestId === "pending") {
      return blocked("RUN_AGENT_UNAVAILABLE", "当前 Request 还不能启动 Qoder CLI。");
    }
    if (qoderRecoveryRequired(run, this.#runSession.handoffForSource(run.sourcePath))) {
      return blocked(
        "RUN_AGENT_RECOVERY_REQUIRED",
        "Bridge 无法证明旧 Qoder 会话已经停止。请结束本轮，再重新发送。",
      );
    }
    let preflight = preflightId ? { preflightId, status: "ready" } : null;
    try {
      if (!preflight) {
        preflight = await this.#bridgeClient.preflightAgent({
          driver: "qoder-acp",
          trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        });
      }
      if (preflight?.status !== "ready" || !preflight.preflightId) {
        throw responseError(
          "RUN_AGENT_PREFLIGHT_INVALID",
          "Qoder CLI 预检没有返回可验证结果。",
        );
      }
      this.#runSession.publishHandoff({
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        mode: "qoder-acp",
        status: "starting",
        phase: "launching",
      });
      const result = await this.#bridgeClient.startAgent({
        projectId: run.projectId,
        documentId: run.documentId,
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        driver: "qoder-acp",
        trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        preflightId: preflight.preflightId,
      });
      if (!this.#runSession.hasRun(run)) return stale(run);
      const next = agentHandoffState(run, result?.session);
      if (!next || !["starting", "running", "completed"].includes(next.status)) {
        throw responseError("RUN_AGENT_START_UNCONFIRMED", "Qoder CLI 没有确认启动。");
      }
      this.#runSession.publishHandoff(next);
      this.#emitEvent({
        type: "run-agent-started",
        run,
        agentSession: result.session,
        current: this.#isCurrentRun(run),
      });
      return succeeded({ run, agentSession: result.session });
    } catch (cause) {
      const code = errorCode(cause, "RUN_AGENT_START_FAILED");
      const message = this.#codecs.errorMessage(
        cause,
        "Qoder CLI 没有启动。本轮 Request 已保留，可重试或复制任务。",
      );
      if (this.#runSession.hasRun(run)) {
        this.#runSession.publishHandoff({
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          mode: "qoder-acp",
          status: "failed",
          phase: "failed",
          errorCode: code,
          errorMessage: message,
          retryable: !NON_RETRYABLE_AGENT_ERRORS.has(code),
        });
      }
      this.#emitEvent({
        type: "run-agent-failed",
        run,
        current: this.#isCurrentRun(run),
        cause,
        message,
      });
      return rejected(code, message);
    }
  }

  async cancel({
    run = this.#runSession.activeRun,
    agentMayBeRunning = false,
    reason,
  } = {}) {
    if (!run?.requestId || run.requestId === "pending") {
      return blocked("RUN_CANCEL_UNAVAILABLE", "当前 Request 尚未形成可取消的身份。");
    }
    const operationKey = this.#codecs.operationKey(run);
    if (!this.#runSession.beginOperation("cancel", operationKey)) {
      return blocked("RUN_CANCEL_BUSY", "本轮结束操作正在进行。");
    }
    // Cancellation may outlive a switch away and reopen of the same project.
    // Stable project IDs alone must not let a late response mutate the newer
    // editor generation or its active run.
    const context = this.#isCurrentRun(run)
      ? copyContext(this.#projectSession.context)
      : null;
    try {
      if (run.sourcePath !== "preview://welcome") {
        await this.#bridgeClient.cancelActiveRun({
          projectId: run.projectId,
          documentId: run.documentId,
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          reason: reason || (agentMayBeRunning
            ? "cancelled-by-user-after-agent-handoff"
            : "cancelled-by-user"),
        });
      }
      const tracked = this.#runSession.hasRun(run);
      const current = Boolean(tracked && context && this.#isCurrentContext(context));
      if (tracked) {
        this.#runSession.removeRun(run);
        const handoff = this.#runSession.handoffForSource(run.sourcePath);
        if (
          handoff?.requestId === run.requestId
          && handoff?.attemptId === run.attemptId
        ) this.#runSession.clearHandoff(run.sourcePath);
      }
      if (current) {
        this.#runSession.clearActiveRun();
        this.#canvasPort.unlock();
      }
      this.#emitEvent({
        type: "run-cancelled",
        run,
        current,
        agentMayBeRunning,
      });
      this.syncPolling();
      return succeeded({ run, current });
    } catch (cause) {
      const tracked = this.#runSession.hasRun(run);
      const current = Boolean(tracked && context && this.#isCurrentContext(context));
      if (tracked) {
        this.#runSession.trackRun({
          ...run,
          error: this.#codecs.errorMessage(
            cause,
            "取消结果暂时无法确认。源页会继续在后台核对。",
          ),
        }, { activate: current ? "always" : "never" });
      }
      this.#emitEvent({
        type: "run-cancel-failed",
        run,
        current,
        cause,
      });
      return rejected(errorCode(cause, "RUN_CANCEL_REJECTED"), this.#codecs.errorMessage(
        cause,
        "取消结果暂时无法确认。源页会继续在后台核对。",
      ));
    } finally {
      this.#runSession.endOperation("cancel", operationKey);
    }
  }

  async resolveConflict({
    run = this.#runSession.activeRun,
    action,
  } = {}) {
    if (!run || run.status !== "awaiting-conflict-resolution") {
      return blocked("RUN_CONFLICT_UNAVAILABLE", "当前没有需要处理的 AI 冲突。");
    }
    if (action !== "adopt-ai" && action !== "keep-external") {
      return rejected("RUN_CONFLICT_ACTION_INVALID", "冲突处理方式无效。");
    }
    const operationKey = this.#codecs.operationKey(run);
    if (!this.#runSession.beginOperation("resolve", operationKey)) {
      return blocked("RUN_CONFLICT_BUSY", "冲突处理正在进行。");
    }
    // Conflict resolution may outlive a switch away and reopen of the same
    // project. The stable project IDs alone are not enough to authorize a
    // late result to unlock or reload the newer editor generation.
    const context = this.#isCurrentRun(run)
      ? copyContext(this.#projectSession.context)
      : null;
    try {
      const payload = await this.#bridgeClient.resolveConflict({
        projectId: run.projectId,
        documentId: run.documentId,
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        conflictId: run.conflictId,
        action,
      });
      const current = Boolean(context && this.#isCurrentContext(context));
      if (!this.#runSession.hasRun(run)) return stale(run);
      if (action === "keep-external") {
        this.#runSession.removeRun(run);
        this.#runSession.clearHandoff(run.sourcePath);
        if (current) {
          this.#runSession.clearActiveRun();
          this.#canvasPort.unlock();
        }
        this.#emitEvent({
          type: "run-conflict-resolved",
          run,
          action,
          current,
          reloadCurrentSource: current,
        });
        this.syncPolling();
        return succeeded({ run, action, current, reloadCurrentSource: current });
      }
      const conflict = this.#codecs.isRecord(payload.conflict) ? payload.conflict : null;
      const nextRun = this.#codecs.activeRunFromRecord(
        this.#codecs.isRecord(payload.activeRun)
          ? { ...payload.activeRun, ...(conflict ? { conflict } : {}) }
          : payload,
      ) || { ...run, status: "committing" };
      this.#runSession.trackRun(nextRun, {
        activate: current ? "always" : "never",
      });
      this.#emitEvent({
        type: "run-conflict-resolved",
        run: nextRun,
        action,
        current,
        reloadCurrentSource: false,
      });
      this.syncPolling();
      return succeeded({ run: nextRun, action, current, reloadCurrentSource: false });
    } catch (cause) {
      const current = Boolean(context && this.#isCurrentContext(context));
      if (this.#runSession.hasRun(run)) {
        this.#runSession.trackRun({
          ...run,
          error: this.#codecs.errorMessage(
            cause,
            "这次选择还没有记录，外部文件和 AI 候选都仍被保留。",
          ),
        }, { activate: current ? "always" : "never" });
      }
      this.#emitEvent({
        type: "run-conflict-failed",
        run,
        action,
        current,
        cause,
      });
      return rejected(errorCode(cause, "RUN_CONFLICT_REJECTED"), this.#codecs.errorMessage(
        cause,
        "这次选择还没有记录，外部文件和 AI 候选都仍被保留。",
      ));
    } finally {
      this.#runSession.endOperation("resolve", operationKey);
    }
  }

  async hydrateRecentRuns({ projects = [], activeSourcePath = null } = {}) {
    const sourcePaths = [...new Set(
      projects
        .map((project) => project?.sourcePath)
        .filter((sourcePath) => sourcePath && !this.#codecs.sameSourcePath(
          sourcePath,
          activeSourcePath,
        )),
    )];
    const recovered = await Promise.allSettled(sourcePaths.map(async (sourcePath) => {
      const payload = await this.#bridgeClient.workspace(sourcePath);
      const runtime = this.#codecs.isRecord(payload.runtimeState) ? payload.runtimeState : {};
      const conflict = this.#codecs.isRecord(runtime.conflict) ? runtime.conflict : null;
      const record = this.#codecs.isRecord(runtime.activeRun)
        ? runtime.activeRun
        : this.#codecs.isRecord(payload.activeRun)
          ? payload.activeRun
          : null;
      const run = this.#codecs.activeRunFromRecord(
        record ? { ...record, ...(conflict ? { conflict } : {}) } : null,
      );
      const outcome = this.#codecs.activeRunFromRecord(payload.recentRunOutcome);
      if (outcome) this.#runSession.rememberOutcome(outcome);
      if (run && isPollable(run)) {
        this.#runSession.trackRun(run, { activate: "never", recovered: true });
        return run;
      }
      return null;
    }));
    this.syncPolling();
    return succeeded({
      recovered: recovered.filter((result) => result.status === "fulfilled" && result.value).length,
      attempted: sourcePaths.length,
    });
  }

  async #pollRun(run, generation) {
    if (!this.#isPollCurrent(generation) || !this.#runSession.hasRun(run)) {
      return stale(run);
    }
    const operationKey = this.#codecs.operationKey(run);
    if (this.#runSession.isOperationBusy("activate", operationKey)) {
      return blocked(
        "RUN_POLL_ACTIVATION_BUSY",
        "当前候选版本正在打开，状态核对已延后。",
      );
    }
    if (!this.#runSession.beginOperation("poll", operationKey)) {
      return blocked("RUN_POLL_BUSY", "本轮状态正在核对。");
    }
    try {
      const payload = await this.#bridgeClient.status(
        run.sourcePath,
        run.requestId,
        run.attemptId,
      );
      if (
        !this.#isPollCurrent(generation)
        || !this.#runSession.hasRun(run)
        || this.#runSession.isOperationBusy("activate", operationKey)
      ) {
        return stale(run);
      }
      return this.#processStatus(run, payload);
    } catch (cause) {
      // A transient status read is intentionally non-terminal. The next owned
      // polling pass is the only retry path and never replays Request creation.
      return rejected(errorCode(cause, "RUN_POLL_REJECTED"), this.#codecs.errorMessage(
        cause,
        "任务状态暂时无法读取。",
      ));
    } finally {
      this.#runSession.endOperation("poll", operationKey);
    }
  }

  #processStatus(run, payload) {
    const previousHandoff = this.#runSession.handoffForSource(run.sourcePath);
    const agentState = agentHandoffState(run, payload.agentSession);
    const clipboardFallbackActive = previousHandoff?.mode === "clipboard"
      && ["copying", "copied"].includes(previousHandoff.status);
    if (agentState && !clipboardFallbackActive) {
      this.#runSession.publishHandoff(agentState);
      if (
        ["failed", "interrupted"].includes(agentState.status)
        && previousHandoff?.status !== agentState.status
      ) {
        this.#emitEvent({
          type: "run-agent-failed",
          run,
          agentSession: payload.agentSession,
          current: this.#isCurrentRun(run),
          message: agentState.errorMessage,
        });
      }
    }
    const rawState = String(payload.status || payload.lifecycleState || "processing");
    const state = this.#codecs.canonicalLifecycleState(rawState, {
      readyVersion: Boolean(payload.versionId),
    });
    const current = this.#isCurrentRun(run);
    const previousState = this.#runSession.runForSource(run.sourcePath)?.status;
    if (state === "ready-to-open") {
      const nextRun = this.#codecs.activeRunFromRecord({
        ...run,
        ...payload,
        status: "ready-to-open",
        readyPayload: payload,
        completionObserved: true,
      }) || { ...run, status: "ready-to-open", readyPayload: payload, completionObserved: true };
      this.#runSession.trackRun(nextRun, { activate: current ? "always" : "never" });
      if (current) this.#runSession.clearResult(run.sourcePath);
      else if (previousState !== "ready-to-open") {
        this.#runSession.markResult(run.sourcePath, {
          state: "ready",
          label: "新版本可查看",
          updatedAt: this.#clock.now(),
        });
      }
      this.#emitEvent({ type: "run-status", run: nextRun, state, current, previousState });
      return succeeded({ run: nextRun, state, current, previousState });
    }
    if (state === "no-change" || state === "error") {
      this.#runSession.removeRun(run);
      const fallback = state === "no-change"
        ? { ...run, status: state, completionObserved: true }
        : {
            ...run,
            status: state,
            error: "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
            completionObserved: payload.completionObserved === true,
          };
      const terminalRun = this.#codecs.activeRunFromRecord({
        ...run,
        ...payload,
        status: state,
      })
        || fallback;
      this.#runSession.rememberOutcome(terminalRun);
      if (current) {
        this.#runSession.clearResult(run.sourcePath);
        this.#runSession.setActiveRun(terminalRun);
        this.#canvasPort.unlock();
      } else {
        this.#runSession.markResult(run.sourcePath, {
          state: state === "no-change" ? "no-change" : "error",
          label: state === "no-change" ? "已完成 · 无变化" : "需要处理",
          updatedAt: this.#clock.now(),
        });
      }
      this.#emitEvent({ type: "run-status", run: terminalRun, state, current, previousState });
      return succeeded({ run: terminalRun, state, current, previousState });
    }
    if (state === "cancelled") {
      this.#runSession.removeRun(run);
      this.#runSession.clearHandoff(run.sourcePath);
      if (current) {
        this.#runSession.clearResult(run.sourcePath);
        this.#runSession.clearActiveRun();
        this.#canvasPort.unlock();
      }
      this.#emitEvent({ type: "run-status", run, state, current, previousState });
      return succeeded({ run, state, current, previousState });
    }
    const conflict = this.#codecs.isRecord(payload.conflict) ? payload.conflict : null;
    const nextRun = this.#codecs.activeRunFromRecord(
      this.#codecs.isRecord(payload.activeRun)
        ? { ...payload.activeRun, ...(conflict ? { conflict } : {}) }
        : { ...run, ...payload, status: state },
    ) || { ...run, status: state };
    this.#runSession.trackRun(nextRun, { activate: current ? "always" : "never" });
    if (current) this.#runSession.clearResult(run.sourcePath);
    else if (nextRun.status === "awaiting-conflict-resolution") {
      this.#runSession.markResult(run.sourcePath, {
        state: "conflict",
        label: "需要处理",
        updatedAt: this.#clock.now(),
      });
    } else {
      this.#runSession.markResult(run.sourcePath, {
        state: "processing",
        label: "正在处理",
        updatedAt: this.#clock.now(),
      });
    }
    this.#emitEvent({ type: "run-status", run: nextRun, state, current, previousState });
    return succeeded({ run: nextRun, state, current, previousState });
  }

  #commentsForSubmission() {
    const comments = this.#canvasPort.normalizeComments();
    return Array.isArray(comments)
      ? comments.filter(this.#codecs.commentHasContent)
      : [];
  }

  #validateComments(comments, sourceSha256 = null, expectedCount = null) {
    if (comments.length === 0) {
      return blocked("RUN_SUBMISSION_COMMENTS_EMPTY", "请先添加至少一条已保存的评论。");
    }
    if (
      expectedCount !== null
      && comments.length !== expectedCount
    ) {
      return blocked(
        "RUN_SUBMISSION_COMMENTS_CHANGED",
        "最新评论在冻结边界内发生变化，请重新确认后再发送。",
      );
    }
    const unsafe = comments.find((comment) => (
      !this.#codecs.canLocateTarget(comment.target)
      || (
        sourceSha256
        && comment.target?.sourceAnchor?.sourceSha256
          && comment.target.sourceAnchor.sourceSha256 !== sourceSha256
      )
    ));
    if (unsafe) {
      return blocked(
        "RUN_SUBMISSION_TARGET_UNSAFE",
        "有评论目标未能与当前源 HTML 对齐，请重新选择后再发送。",
      );
    }
    return null;
  }

  #summary(comments) {
    return comments.map((comment) => (
      String(comment.text || "").trim()
      || `参考附件：${(comment.attachments || []).map((item) => item.fileName).join("、")}`
    )).join("；").slice(0, 5_000);
  }

  #pendingRun({ context, previousVersionId, basedOnVersionId, deliveryMode }) {
    return {
      projectId: context.projectId,
      documentId: context.documentId,
      requestId: "pending",
      attemptId: "attempt_001",
      requestPath: "",
      attemptPath: "",
      handoffMessage: "",
      agentDelivery: { mode: deliveryMode },
      status: "submitting",
      sourcePath: context.sourcePath,
      baseSnapshotSha256: context.frozenSourceSha256,
      previousVersionId: previousVersionId || null,
      basedOnVersionId: basedOnVersionId || null,
      freezeCutoffRevision: context.freezeCutoffRevision,
      candidateVersionId: "",
      candidateVersionLabel: "下一版",
      submittedAt: validDate(this.#clock),
      summary: this.#summary(context.comments),
      commentCount: context.comments.length,
      changeEventCount: context.changeEvents.length,
    };
  }

  #runFromRequestPayload(payload) {
    if (!this.#codecs.isRecord(payload)) return null;
    return this.#codecs.activeRunFromRecord(
      this.#codecs.isRecord(payload.activeRun)
        ? {
            ...payload.activeRun,
            candidateDisplayVersionLabel: payload.candidateDisplayVersionLabel,
          }
        : payload,
    );
  }

  #runMatchesContext(run, context) {
    return Boolean(
      run
      && context
      && this.#codecs.sameSourcePath(run.sourcePath, context.sourcePath)
      && run.projectId === context.projectId
      && run.documentId === context.documentId,
    );
  }

  #isCurrentContext(context) {
    return Boolean(
      !this.#disposed
      && context
      && this.#projectSession.matches(context),
    );
  }

  #isCurrentRun(run) {
    if (!run) return false;
    const context = this.#projectSession.context;
    return Boolean(
      context
      && this.#codecs.sameSourcePath(run.sourcePath, context.sourcePath)
      && (!run.projectId || run.projectId === context.projectId)
      && (!run.documentId || run.documentId === context.documentId),
    );
  }

  #settleUncertainSubmission(key, entry) {
    if (this.#uncertainSubmissions.get(key)?.submission?.token !== entry.submission.token) {
      return false;
    }
    this.#uncertainSubmissions.delete(key);
    this.#runSession.releaseSubmission(entry.submission);
    this.#publishSnapshot();
    return true;
  }

  #hasPollingWork() {
    return this.#uncertainSubmissions.size > 0
      || this.#runSession.runs.some(isPollable);
  }

  #isPollCurrent(generation) {
    return !this.#disposed && generation === this.#pollGeneration;
  }

  #publishSnapshot() {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Presentation observation cannot affect run authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation observation cannot affect run authority.
      }
    }
  }
}
