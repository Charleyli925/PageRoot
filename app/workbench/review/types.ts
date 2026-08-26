import type {
  RuntimeSnapshotCaptureCandidate,
} from "../../domain/runtime-snapshot-hosts.js";
import type {
  ReviewRuntimeVisualCandidate,
} from "../../lib/review-runtime-visual.js";
import type {
  ReviewSemanticAlignmentMatch,
} from "../../lib/review-semantic-alignment.js";
import type {
  ReviewTextChangeOperation,
} from "../../lib/review-text-diff.js";
import type { CommentItem } from "../types";
import type {
  ReviewRuntimeVisualCaptureIdentity,
} from "../review-runtime-capture-adapter";

export type ReviewFilter = "all" | "text" | "structure" | "style";
export type ReviewChangeType = Exclude<ReviewFilter, "all">;
export type ReviewSide = "before" | "after";

export type ReviewChange = {
  id: string;
  label: string;
  helper: string;
  types: ReviewChangeType[];
  suspected?: boolean;
  beforePresent: boolean;
  afterPresent: boolean;
  panelKey?: string;
  panelPath?: string[];
  movement?: { from: number; to: number };
};

export type ReviewOutlineItem = {
  id: string;
  group: string;
  label: string;
  helper: string;
  changeId?: string;
  panelKey?: string;
  panelPath?: string[];
  types: ReviewChangeType[];
  movement?: { from: number; to: number };
};

export type ReviewDocuments = {
  before: string;
  after: string;
  bootstrapJavaScript: Record<ReviewSide, string>;
  bootstrapFallbackJavaScript: Record<ReviewSide, string>;
  changes: ReviewChange[];
  outline: ReviewOutlineItem[];
  runtimeVisualCandidates: ReviewRuntimeVisualCandidate[];
  runtimeVisualCaptureCandidates: Record<ReviewSide, RuntimeSnapshotCaptureCandidate[]>;
  runtimeVisualSourceHtml: Record<ReviewSide, string>;
  runtimeVisualCaptureIdentity: ReviewRuntimeVisualCaptureIdentity;
  commentGroups: ReviewCommentGroup[];
  commentTargets: ReviewCommentTarget[];
};

export type ReviewCommentGroup = {
  key: string;
  items: Array<{
    text: string;
    attachmentCount: number;
  }>;
};

export type ReviewCommentTarget = {
  key: string;
  global: boolean;
  selector?: string;
  sourceNodeId?: string;
};

export type ReviewDocumentBuildOptions = {
  sessionId: string;
  sourceSha256BySide: Record<ReviewSide, string>;
  sourcePath?: string;
  externalBootstrap?: boolean;
  comments?: readonly CommentItem[];
};

export type ReviewCommentAnnotations = {
  groups: ReviewCommentGroup[];
  targets: ReviewCommentTarget[];
};

export type ReviewTextInventory = {
  text: string;
  nodes: Array<{ node: Text; start: number; end: number; nodeOffset: number }>;
  breakOffsets: number[];
};

export type ReviewAttributeRole = "stable-identity" | "structural" | "presentation" | "disposable";

export type ReviewSignatureCache = {
  stableIdentity: WeakMap<Element, string | null>;
  selfCompatibility: WeakMap<Element, string>;
  exactSubtree: WeakMap<Element, string>;
};

export type SectionPair = {
  before: Element | null;
  after: Element | null;
  beforeIndex: number;
  afterIndex: number;
  moved?: boolean;
};

export type ReviewBootstrapElementBinding = {
  path: number[];
  tagName: string;
  sourceBoxSignature: string;
  identityAttributes: Array<[string, string]>;
  identityText?: string;
};

export type ReviewCommentBootstrapBinding = ReviewBootstrapElementBinding & {
  sourceNodeId: string;
};

export type ReviewRuntimeBootstrapBinding = ReviewBootstrapElementBinding & {
  candidateKey: string;
};

export type ReviewRuntimeVisualAnnotations = {
  candidates: ReviewRuntimeVisualCandidate[];
  captureCandidates: Record<ReviewSide, RuntimeSnapshotCaptureCandidate[]>;
  bindings: Record<ReviewSide, ReviewRuntimeBootstrapBinding[]>;
};

export type ReviewSemanticUnitKind =
  | "section"
  | "container"
  | "leaf-text-block"
  | "direct-flow"
  | "br-line"
  | "atomic-content"
  | "list"
  | "list-item"
  | "table"
  | "row-group"
  | "table-row"
  | "table-cell";

export type ReviewSemanticUnit = {
  kind: ReviewSemanticUnitKind;
  element: Element;
  inventory: ReviewTextInventory | null;
  children: ReviewSemanticUnit[];
  columnStart?: number;
  columnSpan?: number;
};

export type ReviewSemanticPairNode = {
  before: ReviewSemanticUnit | null;
  after: ReviewSemanticUnit | null;
  match: ReviewSemanticAlignmentMatch;
  moved: boolean;
  semanticOwnerId: string;
  geometryOwnerId: string;
  structureFallback: boolean;
  children: ReviewSemanticPairNode[];
};

export type ReviewSemanticPairGraph = {
  root: ReviewSemanticPairNode;
  signatures: ReviewSignatureCache;
};

export type TextRange = { start: number; end: number };

export type ReviewTextEvidenceGroup = {
  id: string;
  ranges: TextRange[];
  operation: ReviewTextChangeOperation;
  semanticOwnerId: string;
  geometryOwnerId: string;
};
