"use client";

import { useEffect, useRef } from "react";

import type { ReviewAnalysisSession } from "../application/review-analysis-session.js";
import { ReviewAnalysisCancelledError } from "../application/review-analysis-session.js";
import type { ReviewPreparationControllerCapability } from "../application/workspace-controller-capabilities.js";
import type { VersionReviewCandidate } from "../application/version-workflow.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import { browserSha256 } from "./browser-io";
import { commentHasContent } from "./comment-relink-model.js";
import { activeRunOperationKey } from "./project-model";
import {
  buildReviewDocumentsAsync,
  buildReviewShellDocuments,
  type ReviewDocuments,
  type ReviewImpact,
} from "./review-document";
import type { CommentItem, PersistState } from "./types";

export type PreparedReviewDocuments = {
  operationKey: string;
  beforeHtml: string;
  afterHtml: string;
  sourcePath: string;
  commentsKey: string;
  sessionId: string;
  documents: ReviewDocuments;
};

export function preparedReviewByteSize(prepared: PreparedReviewDocuments): number {
  return 2 * (
    prepared.beforeHtml.length
    + prepared.afterHtml.length
    + prepared.commentsKey.length
    + prepared.documents.before.length
    + prepared.documents.after.length
    + prepared.documents.bootstrapJavaScript.before.length
    + prepared.documents.bootstrapJavaScript.after.length
    + prepared.documents.bootstrapFallbackJavaScript.before.length
    + prepared.documents.bootstrapFallbackJavaScript.after.length
    + JSON.stringify(prepared.documents.commentTargets).length
    + JSON.stringify(prepared.documents.reviewImpact || null).length
  );
}

function reviewImpactFromCandidate(
  candidate: VersionReviewCandidate,
): ReviewImpact | undefined {
  const assessment = candidate.candidateAssessment;
  if (
    !assessment
    || !Array.isArray(assessment.changedStableElementIds)
    || !Array.isArray(assessment.requestedTargetElementIds)
    || !Array.isArray(assessment.outsideRequestedTargetElementIds)
  ) return undefined;
  const recordedTargetCount = assessment.requestedTargetCount;
  const requestedTargetCount = typeof recordedTargetCount === "number"
    && Number.isSafeInteger(recordedTargetCount)
    && recordedTargetCount >= 0
    ? recordedTargetCount
    : assessment.requestedTargetElementIds.length;
  return {
    requestedTargetCount,
    actualChangedElementCount: assessment.changedStableElementIds.length,
    outsideRequestedTargetCount: assessment.outsideRequestedTargetElementIds.length,
    changedStableElementIds: [...assessment.changedStableElementIds],
    requestedTargetElementIds: [...assessment.requestedTargetElementIds],
    outsideRequestedTargetElementIds: [...assessment.outsideRequestedTargetElementIds],
  };
}

export function reviewCommentsForAnalysis(comments: readonly CommentItem[]): CommentItem[] {
  return comments.filter(commentHasContent).map((comment) => ({
    ...comment,
    target: {
      ...comment.target,
      ...(comment.target.sourceAnchor
        ? { sourceAnchor: { ...comment.target.sourceAnchor } }
        : {}),
      ...(comment.target.fingerprint
        ? {
            fingerprint: {
              ...comment.target.fingerprint,
              stableAttributes: { ...comment.target.fingerprint.stableAttributes },
              ancestorFingerprint: [...comment.target.fingerprint.ancestorFingerprint],
            },
          }
        : {}),
      ...(comment.target.boundingBox
        ? { boundingBox: { ...comment.target.boundingBox } }
        : {}),
    },
    ...(comment.attachments?.length
      ? { attachments: comment.attachments.map((item) => ({ ...item })) }
      : {}),
  }));
}

export async function prepareReviewAnalysis({
  session,
  candidate,
  beforeHtml,
  comments,
  externalBootstrap,
  sessionId,
  onShell,
}: {
  session: ReviewAnalysisSession<PreparedReviewDocuments>;
  candidate: VersionReviewCandidate;
  beforeHtml: string;
  comments: readonly CommentItem[];
  externalBootstrap: boolean;
  sessionId: string;
  onShell?: (documents: ReviewDocuments) => void;
}): Promise<PreparedReviewDocuments> {
  const reviewComments = reviewCommentsForAnalysis(comments);
  const reviewImpact = reviewImpactFromCandidate(candidate);
  const commentsKey = JSON.stringify(reviewComments);
  const cacheKey = [
    candidate.operationKey,
    candidate.baseSnapshotSha256,
    candidate.sha256,
    JSON.stringify(candidate.candidateAssessment || null),
    candidate.sourcePath,
    externalBootstrap ? "external" : "inline",
    await browserSha256(commentsKey),
  ].join("\u0000");
  const cached = session.peek(cacheKey);
  if (cached) return cached;
  onShell?.(buildReviewShellDocuments(beforeHtml, candidate.content, {
    sessionId,
    sourcePath: candidate.sourcePath,
    externalBootstrap,
    ...(reviewImpact ? { reviewImpact } : {}),
  }));
  return session.analyze({
    key: cacheKey,
    compute: async ({ isCancelled }) => ({
      operationKey: candidate.operationKey,
      beforeHtml,
      afterHtml: candidate.content,
      sourcePath: candidate.sourcePath,
      commentsKey,
      sessionId,
      documents: await buildReviewDocumentsAsync(beforeHtml, candidate.content, {
        sessionId,
        sourcePath: candidate.sourcePath,
        externalBootstrap,
        comments: reviewComments,
        ...(reviewImpact ? { reviewImpact } : {}),
      }, { isCancelled }),
    }),
  });
}

export default function ReviewAnalysisPrewarm({
  session,
  controller,
  activeRun,
  projectId,
  documentId,
  sourceSha256,
  editRevision,
  lastPersistedRevision,
  persistState,
  html,
  comments,
  projectHydrating,
  projectLoadError,
}: {
  session: ReviewAnalysisSession<PreparedReviewDocuments>;
  controller: ReviewPreparationControllerCapability | null;
  activeRun: ActiveRun | null;
  projectId: string;
  documentId: string;
  sourceSha256: string | null;
  editRevision: number;
  lastPersistedRevision: number;
  persistState: PersistState;
  html: string;
  comments: readonly CommentItem[];
  projectHydrating: boolean;
  projectLoadError: unknown;
}) {
  const identityRef = useRef("");
  const sequenceRef = useRef(0);

  useEffect(() => {
    const run = activeRun;
    if (
      !run
      || !controller
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || projectHydrating
      || projectLoadError
      || projectId !== run.projectId
      || documentId !== run.documentId
      || sourceSha256 !== run.baseSnapshotSha256
      || editRevision !== lastPersistedRevision
      || persistState !== "idle"
    ) return;
    const operationKey = activeRunOperationKey(run);
    const reviewComments = reviewCommentsForAnalysis(comments);
    const commentsKey = JSON.stringify(reviewComments);
    const identity = [operationKey, sourceSha256, commentsKey].join("\u0000");
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    let cancelled = false;
    void (async () => {
      const outcome = await controller.prepareReviewCandidate({ run });
      if (cancelled || outcome.status !== "succeeded") return;
      const candidate = outcome.value as VersionReviewCandidate;
      const current = controller.getSnapshot();
      if (
        current.projectSession?.projectId !== candidate.projectId
        || current.projectSession?.documentId !== candidate.documentId
        || current.document?.sourceSha256 !== candidate.baseSnapshotSha256
        || current.document?.html !== html
      ) return;
      const externalBootstrap = Boolean(window.htmlAIPreview);
      const cacheKey = [
        candidate.operationKey,
        candidate.baseSnapshotSha256,
        candidate.sha256,
        JSON.stringify(candidate.candidateAssessment || null),
        candidate.sourcePath,
        externalBootstrap ? "external" : "inline",
        await browserSha256(commentsKey),
      ].join("\u0000");
      if (cancelled || session.peek(cacheKey)) return;
      const sessionId = `review-prewarm-${Date.now().toString(36)}-${++sequenceRef.current}`;
      const reviewImpact = reviewImpactFromCandidate(candidate);
      await session.analyze({
        key: cacheKey,
        compute: async ({ isCancelled }) => ({
          operationKey: candidate.operationKey,
          beforeHtml: html,
          afterHtml: candidate.content,
          sourcePath: candidate.sourcePath,
          commentsKey,
          sessionId,
          documents: await buildReviewDocumentsAsync(html, candidate.content, {
            sessionId,
            sourcePath: candidate.sourcePath,
            externalBootstrap,
            comments: reviewComments,
            ...(reviewImpact ? { reviewImpact } : {}),
          }, { isCancelled }),
        }),
      });
      performance.mark("pageroot:review:prewarmed");
    })().catch((cause) => {
      if (cause instanceof ReviewAnalysisCancelledError || cancelled) return;
      // Optional prewarming never owns the explicit Review command's errors.
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeRun,
    comments,
    controller,
    documentId,
    editRevision,
    html,
    lastPersistedRevision,
    persistState,
    projectHydrating,
    projectId,
    projectLoadError,
    session,
    sourceSha256,
  ]);

  return null;
}
