import type {
  AiConversationControllerCapability,
  CommentControllerCapability,
  DocumentSurfaceControllerCapability,
  NavigationWorkflowControllerCapability,
  ReviewPreparationControllerCapability,
  RunSubmissionControllerCapability,
  WorkspaceController,
  WorkspaceSnapshotReader,
} from "../app/application/workspace-controller.js";

declare const controller: WorkspaceController;
declare const conversation: AiConversationControllerCapability;
declare const comments: CommentControllerCapability;
declare const documentSurface: DocumentSurfaceControllerCapability;
declare const navigation: NavigationWorkflowControllerCapability;
declare const review: ReviewPreparationControllerCapability;
declare const runSubmission: RunSubmissionControllerCapability;
declare const snapshotReader: WorkspaceSnapshotReader;

const conversationView: AiConversationControllerCapability = controller;
const commentsView: CommentControllerCapability = controller.comments;
const documentSurfaceView: DocumentSurfaceControllerCapability = controller;
const navigationView: NavigationWorkflowControllerCapability = controller;
const reviewView: ReviewPreparationControllerCapability = controller;
const runSubmissionView: RunSubmissionControllerCapability = controller;
const snapshotView: WorkspaceSnapshotReader = controller;

void conversation.openConversation(null);
conversation.closeConversation();
void comments.getSnapshot();
void comments.subscribe(() => undefined);
comments.commands.updateDraft("draft");
void documentSurface.getSnapshot();
void documentSurface.updateDocumentSurfacePresentation("tab-1");
void navigation.subscribe(() => undefined);
void review.prepareReviewCandidate({ run: null });
void runSubmission.planRunSubmission();
void snapshotReader.getSnapshot();

// @ts-expect-error conversation views cannot mutate Document surface state.
conversation.updateDocumentSurfacePresentation("tab-1");
// @ts-expect-error comment capability does not expose workflow reset authority.
comments.commands.resetCommentWorkflow();
// @ts-expect-error comment capability cannot choose an Agent.
comments.commands.selectAgent({ providerId: "qoder", runtimeId: "acp" });
// @ts-expect-error review preparation cannot choose an Agent.
review.selectAgent({ providerId: "qoder", runtimeId: "acp" });
// @ts-expect-error submission planning cannot mutate comment drafts.
runSubmission.updateCommentDraft("draft");
// @ts-expect-error navigation cannot reach low-level document persistence.
navigation.flushDocument();
// @ts-expect-error snapshot readers cannot subscribe to controller changes.
snapshotReader.subscribe(() => undefined);

void conversationView;
void commentsView;
void documentSurfaceView;
void navigationView;
void reviewView;
void runSubmissionView;
void snapshotView;
