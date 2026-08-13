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

export type EditRuntimeHostBinding = Readonly<{
  key: string;
  path: readonly number[];
  tagName: string;
  identityAttributes: readonly (readonly [string, string])[];
}>;

export function prepareOneShotRuntimeFrameDocument(
  source: string,
  verificationToken: string,
  options: Readonly<{
    sessionId: string;
    executionId: string;
    hosts: readonly EditRuntimeHostBinding[];
    baseUrl?: string;
    editorStyles?: string;
  }>,
): string | null;

export function prepareCanvasFrameDocument(
  source: string,
  verificationToken: string,
  options?: Readonly<{
    mode?: "static";
    baseUrl?: string;
    editorStyles?: string;
  }> | Readonly<{
    mode: "one-shot-runtime";
    sessionId: string;
    executionId: string;
    hosts: readonly EditRuntimeHostBinding[];
    baseUrl?: string;
    editorStyles?: string;
  }>,
): string | null;
export function baseHrefFromSourcePath(
  sourcePath?: string,
): string | undefined;
