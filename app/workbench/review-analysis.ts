import type { ReviewAnalysisSession } from "../application/review-analysis-session.js";
import type { VersionReviewCandidate } from "../application/version-workflow.js";
import { browserSha256 } from "./browser-io";
import { commentHasContent } from "./comment-relink-model.js";
import { commentSourceAnchor } from "./comment-model";
import {
  buildReviewDocumentsAsync,
  buildReviewShellDocuments,
  type ReviewDocuments,
  type ReviewImpact,
} from "./review-document";
import type { CommentItem } from "./types";

const REVIEW_IMPACT_SAMPLE_LIMIT = 100;

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
    + JSON.stringify(prepared.documents.visualBinding).length
    + JSON.stringify(prepared.documents.visualEvidence).length
    + JSON.stringify(prepared.documents.reviewImpact || null).length
    + JSON.stringify(prepared.documents.diagnostics).length
  );
}

function reviewImpactFromCandidate(
  candidate: VersionReviewCandidate,
): ReviewImpact | undefined {
  const assessment = candidate.candidateAssessment;
  if (!assessment) return undefined;
  const recordedTargetCount = assessment.requestedTargetCount;
  const requestedTargetCount = typeof recordedTargetCount === "number"
    && Number.isSafeInteger(recordedTargetCount)
    && recordedTargetCount >= 0
    ? recordedTargetCount
    : 0;
  const changedElementCount = assessment.changedElementCount;
  const outsideTargetCount = assessment.outsideTargetCount;
  if (
    typeof changedElementCount === "number"
    && Number.isSafeInteger(changedElementCount)
    && changedElementCount >= 0
    && typeof outsideTargetCount === "number"
    && Number.isSafeInteger(outsideTargetCount)
    && outsideTargetCount >= 0
    && Array.isArray(assessment.changedElementIdSample)
    && Array.isArray(assessment.outsideTargetElementIdSample)
    && typeof assessment.truncated === "boolean"
  ) {
    return {
      requestedTargetCount,
      actualChangedElementCount: changedElementCount,
      outsideRequestedTargetCount: outsideTargetCount,
      changedElementIdSample: assessment.changedElementIdSample
        .slice(0, REVIEW_IMPACT_SAMPLE_LIMIT),
      outsideTargetElementIdSample: assessment.outsideTargetElementIdSample
        .slice(0, REVIEW_IMPACT_SAMPLE_LIMIT),
      truncated: assessment.truncated,
    };
  }
  if (
    !Array.isArray(assessment.changedStableElementIds)
    || !Array.isArray(assessment.requestedTargetElementIds)
    || !Array.isArray(assessment.outsideRequestedTargetElementIds)
  ) return undefined;
  const changed = assessment.changedStableElementIds;
  const outside = assessment.outsideRequestedTargetElementIds;
  return {
    requestedTargetCount: requestedTargetCount || assessment.requestedTargetElementIds.length,
    actualChangedElementCount: changed.length,
    outsideRequestedTargetCount: outside.length,
    changedElementIdSample: changed.slice(0, REVIEW_IMPACT_SAMPLE_LIMIT),
    outsideTargetElementIdSample: outside.slice(0, REVIEW_IMPACT_SAMPLE_LIMIT),
    truncated: changed.length > REVIEW_IMPACT_SAMPLE_LIMIT
      || outside.length > REVIEW_IMPACT_SAMPLE_LIMIT,
  };
}

export function reviewCommentsForAnalysis(comments: readonly CommentItem[]): CommentItem[] {
  return comments.filter(commentHasContent).map((comment) => {
    const sourceTarget = commentSourceAnchor(comment) || comment.target;
    return {
      ...comment,
      target: {
        ...sourceTarget,
        ...(sourceTarget.sourceAnchor
          ? { sourceAnchor: { ...sourceTarget.sourceAnchor } }
          : {}),
        ...(sourceTarget.fingerprint
          ? {
              fingerprint: {
                ...sourceTarget.fingerprint,
                stableAttributes: { ...sourceTarget.fingerprint.stableAttributes },
                ancestorFingerprint: [...sourceTarget.fingerprint.ancestorFingerprint],
              },
            }
          : {}),
        ...(sourceTarget.boundingBox
          ? { boundingBox: { ...sourceTarget.boundingBox } }
          : {}),
      },
      ...(comment.sourceAnchor
        ? {
            sourceAnchor: {
              ...sourceTarget,
              ...(sourceTarget.sourceAnchor
                ? { sourceAnchor: { ...sourceTarget.sourceAnchor } }
                : {}),
            },
          }
        : {}),
      ...(comment.attachments?.length
        ? { attachments: comment.attachments.map((item) => ({ ...item })) }
        : {}),
    };
  });
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

