"use client";

import { memo, useMemo, useState, useSyncExternalStore } from "react";

import type {
  CommentControllerCapability,
} from "../application/workspace-controller.js";
import type {
  HtmlCanvasSelection,
} from "../components/HtmlCanvasEditor";
import type {
  CommentRailActions,
  CommentRailModel,
  CommentDraft,
  ComposerState,
} from "./comment-rail-contract";
import type { CommentCanvasPort } from "./comment-canvas-port";
import { CommentRailView } from "./comment-rail-view";
import type {
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
} from "./types";

export type CommentRailCapability = CommentControllerCapability<
  CommentItem,
  DirectEditEvent,
  CommentAttachment,
  HtmlCanvasSelection,
  CommentEditSession
>;

function liveComposer(
  composer: ComposerState,
  workingCopy: ReturnType<CommentRailCapability["getSnapshot"]>["workingCopy"],
): ComposerState {
  if (!workingCopy || composer.kind === "relinking") return composer;
  if (composer.kind === "editing") {
    const session = workingCopy.editSession;
    if (!session || session.commentId !== composer.commentId) return composer;
    return {
      ...composer,
      draft: {
        ...composer.draft,
        text: session.draftText,
        attachments: session.draftAttachments,
      },
      session,
    };
  }
  const draft = {
    text: workingCopy.composerDraft,
    commentId: workingCopy.composerCommentId,
    attachments: workingCopy.composerAttachments,
    target: workingCopy.composerTarget,
  };
  if (composer.kind === "new") {
    return {
      kind: "new",
      target: workingCopy.composerTarget || composer.target,
      draft,
    };
  }
  if (!composer.collapsedDraft && !workingCopy.composerTarget) return composer;
  return { kind: "closed", collapsedDraft: draft };
}

function textMeasurementRevision(text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

function shallowEqualRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  ignored = new Set<string>(),
): boolean {
  const leftKeys = Object.keys(left).filter((key) => !ignored.has(key));
  const rightKeys = Object.keys(right).filter((key) => !ignored.has(key));
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(left[key], right[key]));
}

function sameDraft(left: CommentDraft | null, right: CommentDraft | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.text === right.text
    && left.commentId === right.commentId
    && left.attachments === right.attachments
    && left.target === right.target;
}

function sameComposer(left: ComposerState, right: ComposerState): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === "closed" && right.kind === "closed") {
    return sameDraft(left.collapsedDraft, right.collapsedDraft);
  }
  if (left.kind === "new" && right.kind === "new") {
    return left.target === right.target && sameDraft(left.draft, right.draft);
  }
  if (left.kind === "editing" && right.kind === "editing") {
    return left.commentId === right.commentId
      && left.session === right.session
      && sameDraft(left.draft, right.draft);
  }
  return left.kind === "relinking"
    && right.kind === "relinking"
    && left.commentId === right.commentId;
}

/**
 * The first capability container boundary. High-frequency draft text is read
 * directly from controller.comments so it never needs to publish through the
 * Workbench composition root. The remaining presentation model stays behavior-
 * compatible while its local layout ownership migrates behind this boundary.
 */
export const CommentRailContainer = memo(function CommentRailContainer({
  capability,
  canvasPort,
  model,
  actions,
}: {
  capability: CommentRailCapability;
  canvasPort: CommentCanvasPort;
  model: CommentRailModel;
  actions: CommentRailActions;
}) {
  const [expandedOtherTabCommentsKey, setExpandedOtherTabCommentsKey] = useState("");
  const snapshot = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const canvasSnapshot = useSyncExternalStore(
    canvasPort.subscribe,
    canvasPort.getSnapshot,
    canvasPort.getSnapshot,
  );
  const liveModel = useMemo<CommentRailModel>(() => {
    const workingCopy = snapshot.workingCopy;
    const composer = liveComposer(model.composer, workingCopy);
    const draftText = workingCopy?.composerDraft || "";
    const editSession = workingCopy?.editSession;
    const commentMeasurementKeys = editSession
      ? {
          ...model.commentMeasurementKeys,
          [editSession.commentId]: [
            model.commentMeasurementKeys[editSession.commentId] || editSession.commentId,
            textMeasurementRevision(editSession.draftText),
          ].join("::"),
        }
      : model.commentMeasurementKeys;
    return {
      ...model,
      composer,
      otherTabCommentsOpen:
        expandedOtherTabCommentsKey === model.otherTabCommentsContextKey,
      changeEvents: workingCopy?.changeEvents as DirectEditEvent[]
        || model.changeEvents,
      attachmentUploadCount:
        snapshot.persistence?.attachmentUploadCount
        ?? model.attachmentUploadCount,
      composerMeasurementKey:
        `${model.composerMeasurementKey}::${textMeasurementRevision(draftText)}`,
      draftRecoveryMeasurementKey:
        `${model.draftRecoveryMeasurementKey}::${textMeasurementRevision(draftText)}`,
      commentMeasurementKeys,
      selection: canvasSnapshot.selection,
    };
  }, [canvasSnapshot.selection, expandedOtherTabCommentsKey, model, snapshot]);
  const liveActions = useMemo<CommentRailActions>(() => ({
    ...actions,
    updateDraft: (value) => {
      capability.commands.updateDraft(value);
    },
    updateCommentEditDraft: (value) => {
      capability.commands.updateEditDraft(value);
    },
    toggleOtherTabComments: () => {
      setExpandedOtherTabCommentsKey((current) => (
        current === model.otherTabCommentsContextKey
          ? ""
          : model.otherTabCommentsContextKey
      ));
    },
    collapseOtherTabComments: () => setExpandedOtherTabCommentsKey(""),
  }), [actions, capability, model.otherTabCommentsContextKey]);

  return <CommentRailView model={liveModel} actions={liveActions} />;
}, (previous, next) => (
  previous.capability === next.capability
  && previous.canvasPort === next.canvasPort
  && previous.actions === next.actions
  && shallowEqualRecord(
    previous.model as unknown as Record<string, unknown>,
    next.model as unknown as Record<string, unknown>,
    new Set(["composer"]),
  )
  && sameComposer(previous.model.composer, next.model.composer)
));
