export type EditRuntimeCandidateIdentity = Readonly<{
  candidateId: string;
  generation: number;
  sourceRevision: string;
}>;

export type EditRuntimeCandidateSnapshot = Readonly<{
  latestCandidate: EditRuntimeCandidateIdentity | null;
  latestPhase: "preparing" | "positioning" | null;
  lastKnownGood: EditRuntimeCandidateIdentity | null;
  nativeEdit: Readonly<{
    kind: "user" | "resume";
    candidateId: string | null;
  }> | null;
  ignoredCallbackCount: number;
}>;

export type EditRuntimeCandidateSettlement = Readonly<{
  accepted: boolean;
  preserveLastKnownGood: boolean;
  shouldUseStaticFallback: boolean;
}>;

export class EditRuntimeCandidateController {
  readonly snapshot: EditRuntimeCandidateSnapshot;
  beginCandidate(input: {
    generation: number;
    sourceRevision: string;
  }): Readonly<{
    identity: EditRuntimeCandidateIdentity;
    supersededCandidate: EditRuntimeCandidateIdentity | null;
  }>;
  accepts(candidate: EditRuntimeCandidateIdentity): boolean;
  canPromote(candidate: EditRuntimeCandidateIdentity): boolean;
  beginPositioning(candidate: EditRuntimeCandidateIdentity): boolean;
  canFinalize(candidate: EditRuntimeCandidateIdentity): boolean;
  beginNativeEdit(input?: {
    candidate?: EditRuntimeCandidateIdentity | null;
  }): boolean;
  endNativeEdit(): boolean;
  settle(
    candidate: EditRuntimeCandidateIdentity,
    outcome: "ready" | "rejected" | "failed" | "superseded",
  ): EditRuntimeCandidateSettlement;
  reset(): void;
}
