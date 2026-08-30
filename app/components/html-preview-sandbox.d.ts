export const EDITOR_STYLE_ATTRIBUTE: string;
export const FRAME_VERIFICATION_ATTRIBUTE: string;
export const EDIT_RUNTIME_CSP: string;

export function disableExecutableMarkup(source: string): string;
export function sanitizePreviewDocument(
  source: string,
  baseUrl?: string,
): string;
export function sanitizeScrollableDisplayDocument(
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
export function prepareDisposableRuntimeFrameDocument(
  source: string,
  verificationToken: string,
  options: {
    sessionId: string;
    executionId: string;
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
    mode: "disposable-runtime";
    sessionId: string;
    executionId: string;
    baseUrl?: string;
    editorStyles?: string;
  },
): string | null;
export function baseHrefFromSourcePath(
  sourcePath?: string,
): string | undefined;
