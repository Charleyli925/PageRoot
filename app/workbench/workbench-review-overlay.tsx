"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import AiReviewWorkspace from "./AiReviewWorkspace";
import type { ReviewDocuments } from "./review-document";
import type { Toast } from "./types";

type WorkbenchReviewSession = Readonly<{
  sessionId: string;
  documents: ReviewDocuments;
  sourcePath: string;
  beforeLabel: string;
  afterLabel: string;
}>;

export type WorkbenchReviewOverlayProps = Readonly<{
  session: WorkbenchReviewSession;
  accepting: boolean;
  activeRunError?: string;
  candidateAssessmentAttention: boolean;
  onAbout: () => void;
  onCancelBefore: (options: { reason: string }) => Promise<boolean>;
  onNotify: (toast: Toast) => void;
  onAccept: () => void;
  onRevealAiTask: () => void;
  assistantEntry: ReactNode;
  sidebar: ReactNode;
  fileName: string;
  registerReload: (reload: () => void) => () => void;
}>;

export function WorkbenchReviewOverlay({
  session,
  accepting,
  activeRunError,
  candidateAssessmentAttention,
  onAbout,
  onCancelBefore,
  onNotify,
  onAccept,
  onRevealAiTask,
  assistantEntry,
  sidebar,
  fileName,
  registerReload,
}: WorkbenchReviewOverlayProps) {
  const [reloadRevision, setReloadRevision] = useState(0);
  const reload = useCallback(() => {
    setReloadRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    return registerReload(reload);
  }, [registerReload, reload]);

  const onReturnBefore = useCallback(() => {
    void (async () => {
      const restored = await onCancelBefore({
        reason: "declined-ai-candidate-after-review",
      });
      if (!restored) return;
      onNotify({
        title: `已返回 AI 修改前的${session.beforeLabel}`,
        message: `${session.afterLabel} 与本轮记录仍已保留；当前页面可直接继续编辑。`,
        tone: "success",
        dedupeKey: "ready-version-returned-before",
      });
    })();
  }, [onCancelBefore, onNotify, session.afterLabel, session.beforeLabel]);

  return (
    <AiReviewWorkspace
      embedded
      fileName={fileName}
      beforeLabel={session.beforeLabel}
      afterLabel={session.afterLabel}
      sessionId={session.sessionId}
      documents={session.documents}
      sourcePath={session.sourcePath || undefined}
      accepting={accepting}
      error={activeRunError}
      notice={candidateAssessmentAttention
        ? "这个候选可以打开，但与上一版的共同特征较少。请重点核对整页内容，再决定是否接受。"
        : undefined}
      onAbout={onAbout}
      onReturnBefore={onReturnBefore}
      onAccept={onAccept}
      onRevealAiTask={onRevealAiTask}
      assistantEntry={assistantEntry}
      sidebar={sidebar}
      reloadRevision={reloadRevision}
    />
  );
}
