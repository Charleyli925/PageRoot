export const EDITOR_STYLE_ATTRIBUTE: string;
export const FRAME_VERIFICATION_ATTRIBUTE: string;

export function disableExecutableMarkup(source: string): string;
export function sanitizePreviewDocument(
  source: string,
  baseUrl?: string,
): string;
export function prepareVerifiedFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    baseUrl?: string;
    editorStyles?: string;
  },
): string;
export function prepareOneShotRuntimeFrameDocument(
  source: string,
  verificationToken: string,
  options: {
    sessionId: string;
    executionId: string;
    hosts: readonly {
      key: string;
      path: readonly number[];
      tagName: string;
      identityAttributes: readonly (readonly [string, string])[];
    }[];
    baseUrl?: string;
    editorStyles?: string;
  },
): string | null;
export function prepareCanvasFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    mode?: "static";
    baseUrl?: string;
    editorStyles?: string;
  } | {
    mode: "one-shot-runtime";
    sessionId: string;
    executionId: string;
    hosts: readonly {
      key: string;
      path: readonly number[];
      tagName: string;
      identityAttributes: readonly (readonly [string, string])[];
    }[];
    baseUrl?: string;
    editorStyles?: string;
  },
): string | null;
export function baseHrefFromSourcePath(
  sourcePath?: string,
): string | undefined;
