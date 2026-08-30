import type { EditRuntimeGrant } from "../domain/edit-runtime-contract.js";

export type RuntimeFrameContext = {
  verificationToken: string;
  grant: EditRuntimeGrant;
  elementGeneration: number;
  settled: boolean;
};

export function sameRuntimeGrant(
  left: EditRuntimeGrant | null | undefined,
  right: EditRuntimeGrant | null | undefined,
): boolean;

export function frameDocumentMatchesExpected(
  iframe: HTMLIFrameElement,
  expectedFrameHtml: string,
  writtenHtml: string | null,
): boolean;
