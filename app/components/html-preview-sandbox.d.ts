export const EDITOR_STYLE_ATTRIBUTE: string;
export const FRAME_VERIFICATION_ATTRIBUTE: string;

export function disableExecutableMarkup(source: string): string;
export function sanitizePreviewDocument(
  source: string,
  baseUrl?: string,
): string;
export function resolvePreviewBaseHref(
  authoredHref: string | null | undefined,
  sourceBaseUrl: string,
): string;
export function prepareVerifiedFrameDocument(
  source: string,
  verificationToken: string,
  options?: {
    baseUrl?: string;
    editorStyles?: string;
  },
): string;
export function baseHrefFromSourcePath(
  sourcePath?: string,
): string | undefined;
export function previewSessionBaseUrl(sessionUrl: string): string;
