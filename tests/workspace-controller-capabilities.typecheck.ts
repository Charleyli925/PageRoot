import type {
  AiConversationControllerCapability,
  DocumentSurfaceControllerCapability,
  NavigationWorkflowControllerCapability,
  ReviewPreparationControllerCapability,
  WorkspaceController,
  WorkspaceSnapshotReader,
} from "../app/application/workspace-controller.js";

declare const controller: WorkspaceController;
declare const conversation: AiConversationControllerCapability;
declare const documentSurface: DocumentSurfaceControllerCapability;
declare const navigation: NavigationWorkflowControllerCapability;
declare const review: ReviewPreparationControllerCapability;
declare const snapshotReader: WorkspaceSnapshotReader;

const conversationView: AiConversationControllerCapability = controller;
const documentSurfaceView: DocumentSurfaceControllerCapability = controller;
const navigationView: NavigationWorkflowControllerCapability = controller;
const reviewView: ReviewPreparationControllerCapability = controller;
const snapshotView: WorkspaceSnapshotReader = controller;

void conversation.openConversation(null);
conversation.closeConversation();
void documentSurface.getSnapshot();
void documentSurface.updateDocumentSurfacePresentation("tab-1");
void navigation.subscribe(() => undefined);
void review.prepareReviewCandidate({ run: null });
void snapshotReader.getSnapshot();

// @ts-expect-error conversation views cannot mutate Document surface state.
conversation.updateDocumentSurfacePresentation("tab-1");
// @ts-expect-error review preparation cannot choose an Agent.
review.selectAgent({ providerId: "qoder", runtimeId: "acp" });
// @ts-expect-error navigation cannot reach low-level document persistence.
navigation.flushDocument();
// @ts-expect-error snapshot readers cannot subscribe to controller changes.
snapshotReader.subscribe(() => undefined);

void conversationView;
void documentSurfaceView;
void navigationView;
void reviewView;
void snapshotView;
