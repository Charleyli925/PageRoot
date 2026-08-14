export const EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION: 1;

export const EDIT_AUTHOR_RUNTIME_BUDGET: Readonly<{
  htmlBytes: number;
  scriptCount: number;
  scriptBytes: number;
  aggregateScriptBytes: number;
  hostCount: number;
  sourceNodeCount: number;
  runtimeSettleMs: number;
  runtimeDeadlineMs: number;
  orphanSessionTtlMs: number;
}>;

export const EDIT_RUNTIME_PROTOCOL_SCHEME: "pageroot-edit-runtime";
export const EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE: string;
export const EDIT_RUNTIME_HOST_ATTRIBUTE: string;
export const EDIT_RUNTIME_OWNED_ATTRIBUTE: string;
export const EDIT_RUNTIME_SCRIPT_STUB_ATTRIBUTE: string;
export const EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE: string;
export const EDIT_RUNTIME_FROZEN_ATTRIBUTE: string;
export const EDIT_RUNTIME_RESULT_ATTRIBUTE: string;

export type EditRuntimeHostBinding = Readonly<{
  key: string;
  path: readonly number[];
  tagName: string;
  identityAttributes: readonly (readonly [string, string])[];
}>;

export type EditRuntimeGrant = Readonly<{
  contractVersion: number;
  sessionId: string;
  executionId: string;
  sourceSha256: string;
  resourceSha256: string;
  scriptCount: number;
  byteLength: number;
  canvasGeneration: number;
  hosts: readonly EditRuntimeHostBinding[];
}>;

export type EditRuntimePrepareRequest = Readonly<{
  contractVersion: number;
  requestId: string;
  sourceSha256: string;
  html: string;
  hosts: readonly EditRuntimeHostBinding[];
  canvasGeneration: number;
}>;

export type EditRuntimePort = Readonly<{
  prepare(request: EditRuntimePrepareRequest): Promise<EditRuntimeGrant | null>;
  revoke(sessionId: string): Promise<unknown>;
}>;

export type EditRuntimeScript = Readonly<{
  startOffset: number;
  endOffset: number;
  openingTag: string;
  attributes: readonly Readonly<{ name: string; value: string | null }>[];
  type: string;
  src: string | null;
  inline: string;
  executable: boolean;
  index: number | null;
  reason: string | null;
}>;

export function collectEditRuntimeScripts(html: string): Readonly<{
  scripts: readonly EditRuntimeScript[];
  executableScripts: readonly EditRuntimeScript[];
  unsupportedReason: string | null;
}>;
export function hasEditRuntimeEchartsSignal(source: string): boolean;
export function isEditRuntimeEchartsCandidate(html: string): boolean;
export function unsupportedEditRuntimeProgramReason(source: string): string | null;
export function editRuntimeSourceMarker(path: readonly number[]): string | null;
export function isEditRuntimeSessionId(value: unknown): boolean;
export function isEditRuntimeExecutionId(value: unknown): boolean;
export function isEditRuntimeRequestId(value: unknown): boolean;
export function isEditRuntimeSourceSha256(value: unknown): boolean;
export function isEditRuntimeFrameToken(value: unknown): boolean;
export function editRuntimeProtocolUrl(sessionId: string, path: string): string | null;
export function isEditRuntimeProtocolUrl(value: unknown, sessionId?: string | null): boolean;
